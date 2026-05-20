// freee CSV export adapter.
//
// Parses the freee 取引データ CSV export format.
//
// freee export path: 取引 → 一覧 → CSVエクスポート
// Encoding: UTF-8 (freee defaults to UTF-8)
//
// Typical columns:
//   収支区分, 取引日, 決済日, 取引先, 勘定科目, 税区分, 金額, 税額,
//   備考, 品目, 部門, メモタグ, セグメント1, セグメント2, セグメント3

import { Transaction } from '../classifier/types.js';
import { CsvAdapter, CsvSource } from './types.js';

const FREEE_REQUIRED = ['取引日', '金額'];
const FREEE_DETECTION = ['勘定科目', '税区分', '収支区分'];

export class FreeeCsvAdapter implements CsvAdapter {
  readonly source: CsvSource = 'freee_export';
  readonly label = 'freee CSV エクスポート';

  detectFormat(headers: string[]): boolean {
    const h = headers.map(s => s.trim());
    // Must have 取引日 + 金額, and at least one freee-specific column
    return (
      FREEE_REQUIRED.every(req => h.includes(req)) &&
      FREEE_DETECTION.some(det => h.includes(det))
    );
  }

  parseRow(
    row: Record<string, string>,
    rowNumber: number,
  ): { transaction: Transaction | null; skip_reason: string | null } {
    // Parse date
    const dateStr = row['取引日']?.trim();
    if (!dateStr) {
      return { transaction: null, skip_reason: '取引日が空' };
    }
    const date = this.parseDate(dateStr);
    if (!date) {
      return { transaction: null, skip_reason: `日付パース失敗: "${dateStr}"` };
    }

    // Parse amount
    const amountStr = row['金額']?.trim();
    const amount = this.parseAmount(amountStr);
    if (!amount || amount === 0) {
      return { transaction: null, skip_reason: '金額が0またはパース失敗' };
    }

    // Build memo: 備考 or 勘定科目 or fallback
    const bikou = row['備考']?.trim() || '';
    const kanjou = row['勘定科目']?.trim() || '';
    const memoTag = row['メモタグ']?.trim() || '';
    const memo = bikou || kanjou || memoTag || `取引 ${date}`;

    // Partner name
    const partner_name = row['取引先']?.trim() || undefined;

    return {
      transaction: { amount, memo, date, partner_name },
      skip_reason: null,
    };
  }

  private parseDate(dateStr: string): string | null {
    // freee uses "YYYY-MM-DD" or "YYYY/MM/DD"
    const match = dateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }

  private parseAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    const cleaned = amountStr.replace(/[,、￥¥\s]/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : Math.abs(num);
  }
}
