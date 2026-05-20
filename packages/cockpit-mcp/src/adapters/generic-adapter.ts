// Generic CSV adapter with user-specified column mapping.
//
// Used when the CSV doesn't match any known format (弥生/freee/MF).
// User provides a ColumnMapping to specify which columns contain date, amount, memo.

import { Transaction } from '../classifier/types.js';
import { CsvAdapter, CsvSource, ColumnMapping } from './types.js';

export class GenericCsvAdapter implements CsvAdapter {
  readonly source: CsvSource = 'generic';
  readonly label = '汎用 CSV';

  private mapping: ColumnMapping;

  constructor(mapping: ColumnMapping) {
    this.mapping = mapping;
  }

  /**
   * Generic adapter always returns true for detectFormat
   * (it's the fallback when no other adapter matches).
   */
  detectFormat(_headers: string[]): boolean {
    return true;
  }

  parseRow(
    row: Record<string, string>,
    rowNumber: number,
  ): { transaction: Transaction | null; skip_reason: string | null } {
    // Date
    const dateStr = row[this.mapping.date]?.trim();
    if (!dateStr) {
      return { transaction: null, skip_reason: `日付列 "${this.mapping.date}" が空` };
    }
    const date = this.parseDate(dateStr);
    if (!date) {
      return { transaction: null, skip_reason: `日付パース失敗: "${dateStr}"` };
    }

    // Amount
    const amountStr = row[this.mapping.amount]?.trim();
    const amount = this.parseAmount(amountStr);
    if (!amount || amount === 0) {
      return { transaction: null, skip_reason: '金額が0またはパース失敗' };
    }

    // Memo
    const memo = row[this.mapping.memo]?.trim() || '';
    if (!memo) {
      return { transaction: null, skip_reason: `摘要列 "${this.mapping.memo}" が空` };
    }

    // Partner (optional)
    const partner_name = this.mapping.partner_name
      ? row[this.mapping.partner_name]?.trim() || undefined
      : undefined;

    return {
      transaction: { amount, memo, date, partner_name },
      skip_reason: null,
    };
  }

  private parseDate(dateStr: string): string | null {
    // Try common date formats
    // "YYYY/MM/DD", "YYYY-MM-DD", "YYYY.MM.DD"
    const match = dateStr.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // "MM/DD/YYYY" (US format)
    const usMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (usMatch) {
      const [, m, d, y] = usMatch;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }

  private parseAmount(amountStr: string | undefined): number {
    if (!amountStr) return 0;
    const cleaned = amountStr.replace(/[,、￥¥$\s]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.abs(Math.round(num));
  }
}
