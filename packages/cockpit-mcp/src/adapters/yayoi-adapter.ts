// 弥生会計 (Yayoi) CSV adapter.
//
// Parses the 仕訳日記帳 CSV export format.
//
// 弥生 exports several CSV formats. This adapter handles the most common:
//   Format A: 仕訳日記帳 (Journal Ledger) — full double-entry bookkeeping
//   Format B: 簡易帳簿 (Simple Bookkeeping) — single-entry (個人事業主向け)
//
// Both formats are supported via header auto-detection.
//
// ⚠ Important: 弥生 defaults to Shift-JIS encoding.
// Users must select UTF-8 when exporting:
//   弥生 → ファイル → エクスポート → 文字コード → UTF-8

import { Transaction } from '../classifier/types.js';
import { CsvAdapter, CsvSource } from './types.js';

/**
 * 弥生 仕訳日記帳 Format A headers (full double-entry).
 *
 * Typical columns (order may vary):
 *   識別フラグ, 伝票No., 決算, 取引日付, 借方勘定科目, 借方補助科目,
 *   借方部門, 借方税区分, 借方金額, 借方税金額, 貸方勘定科目, 貸方補助科目,
 *   貸方部門, 貸方税区分, 貸方金額, 貸方税金額, 摘要, 番号, 期日, タイプ, 生成元, 仕訳メモ
 */
const YAYOI_FULL_REQUIRED = ['取引日付', '借方勘定科目', '借方金額', '摘要'];
const YAYOI_FULL_OPTIONAL = ['貸方勘定科目', '貸方金額', '借方税区分', '貸方税区分', '伝票No.', '仕訳メモ'];

/**
 * 弥生 簡易帳簿 Format B headers (single-entry, 個人事業主).
 *
 * Typical columns:
 *   日付, 科目, 金額, 摘要, 取引先
 */
const YAYOI_SIMPLE_REQUIRED = ['日付', '科目', '金額', '摘要'];

export class YayoiAdapter implements CsvAdapter {
  readonly source: CsvSource = 'yayoi';
  readonly label = '弥生会計 CSV';

  private format: 'full' | 'simple' | null = null;

  detectFormat(headers: string[]): boolean {
    // Normalize: trim whitespace
    const h = headers.map(s => s.trim());

    // Check Format A (full double-entry)
    if (YAYOI_FULL_REQUIRED.every(req => h.includes(req))) {
      this.format = 'full';
      return true;
    }

    // Check Format B (simple bookkeeping)
    if (YAYOI_SIMPLE_REQUIRED.every(req => h.includes(req))) {
      this.format = 'simple';
      return true;
    }

    return false;
  }

  parseRow(
    row: Record<string, string>,
    rowNumber: number,
  ): { transaction: Transaction | null; skip_reason: string | null } {
    if (this.format === 'full') {
      return this.parseFullRow(row, rowNumber);
    } else if (this.format === 'simple') {
      return this.parseSimpleRow(row, rowNumber);
    }
    return { transaction: null, skip_reason: 'Unknown 弥生 format' };
  }

  /**
   * Parse Format A: 仕訳日記帳 (double-entry).
   *
   * Logic:
   * - Uses 借方金額 as amount (expense side). If 0, uses 貸方金額 (income side).
   * - Combines 摘要 + 仕訳メモ for the memo field.
   * - Skips rows where 識別フラグ indicates non-transaction lines (headers, totals).
   */
  private parseFullRow(
    row: Record<string, string>,
    rowNumber: number,
  ): { transaction: Transaction | null; skip_reason: string | null } {
    // Skip non-transaction rows (識別フラグ: 2000=通常仕訳, 2100=決算仕訳)
    const flag = row['識別フラグ']?.trim();
    if (flag && !['2000', '2100', ''].includes(flag)) {
      return { transaction: null, skip_reason: `識別フラグ=${flag} (非仕訳行)` };
    }

    // Parse date
    const dateStr = row['取引日付']?.trim();
    const date = this.parseDate(dateStr);
    if (!date) {
      return { transaction: null, skip_reason: `日付パース失敗: "${dateStr}"` };
    }

    // Parse amount: prefer 借方金額 (expense), fall back to 貸方金額 (income)
    const debitAmount = this.parseAmount(row['借方金額']);
    const creditAmount = this.parseAmount(row['貸方金額']);
    const amount = debitAmount || creditAmount;
    if (!amount || amount === 0) {
      return { transaction: null, skip_reason: '金額が0またはパース失敗' };
    }

    // Build memo: 摘要 + 仕訳メモ (if present)
    const tekiyou = row['摘要']?.trim() || '';
    const memo_note = row['仕訳メモ']?.trim() || '';
    const memo = memo_note ? `${tekiyou} ${memo_note}` : tekiyou;
    if (!memo) {
      return { transaction: null, skip_reason: '摘要が空' };
    }

    // Extract partner name from 摘要 if it contains a known pattern
    // (弥生 doesn't have a dedicated partner column in Format A)
    const partner_name = this.extractPartner(row);

    return {
      transaction: { amount, memo, date, partner_name },
      skip_reason: null,
    };
  }

  /**
   * Parse Format B: 簡易帳簿 (single-entry).
   */
  private parseSimpleRow(
    row: Record<string, string>,
    rowNumber: number,
  ): { transaction: Transaction | null; skip_reason: string | null } {
    const dateStr = row['日付']?.trim();
    const date = this.parseDate(dateStr);
    if (!date) {
      return { transaction: null, skip_reason: `日付パース失敗: "${dateStr}"` };
    }

    const amount = this.parseAmount(row['金額']);
    if (!amount || amount === 0) {
      return { transaction: null, skip_reason: '金額が0またはパース失敗' };
    }

    const memo = row['摘要']?.trim() || '';
    if (!memo) {
      return { transaction: null, skip_reason: '摘要が空' };
    }

    const partner_name = row['取引先']?.trim() || undefined;

    return {
      transaction: { amount, memo, date, partner_name },
      skip_reason: null,
    };
  }

  /**
   * Parse date from various 弥生 formats:
   *   - "2026/05/01" (Western calendar)
   *   - "2026-05-01" (ISO)
   *   - "R08/05/01" (和暦 令和)
   *   - "H28/05/01" (和暦 平成)
   * Returns ISO format "YYYY-MM-DD" or null.
   */
  private parseDate(dateStr: string | undefined): string | null {
    if (!dateStr) return null;
    const s = dateStr.trim();

    // Western calendar: "2026/05/01" or "2026-05-01"
    const westernMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (westernMatch) {
      const [, y, m, d] = westernMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    // 和暦: "R08/05/01" (令和), "H28/05/01" (平成)
    const warekiMatch = s.match(/^([RrHh])(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (warekiMatch) {
      const [, era, ey, m, d] = warekiMatch;
      const eraYear = parseInt(ey);
      let year: number;
      if (era === 'R' || era === 'r') {
        year = 2018 + eraYear; // 令和1年 = 2019
      } else {
        year = 1988 + eraYear; // 平成1年 = 1989
      }
      return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    return null;
  }

  /**
   * Parse amount string, removing commas and handling negative values.
   * "12,000" → 12000, "-3,000" → 3000 (absolute value for classification).
   */
  private parseAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    const cleaned = amountStr.replace(/[,、￥¥\s]/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : Math.abs(num);
  }

  /**
   * Try to extract partner name from 弥生 Format A.
   * Format A doesn't have a dedicated partner column, but some users
   * put the partner name in 借方補助科目 or 貸方補助科目.
   */
  private extractPartner(row: Record<string, string>): string | undefined {
    // Check 借方補助科目 / 貸方補助科目
    const debitSub = row['借方補助科目']?.trim();
    const creditSub = row['貸方補助科目']?.trim();
    return debitSub || creditSub || undefined;
  }
}
