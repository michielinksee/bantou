import { describe, it, expect, beforeEach } from 'vitest';
import { YayoiAdapter } from '../yayoi-adapter.js';

describe('YayoiAdapter', () => {
  let adapter: YayoiAdapter;

  beforeEach(() => {
    adapter = new YayoiAdapter();
  });

  // Format detection
  describe('detectFormat', () => {
    it('should detect Format A (仕訳日記帳) headers', () => {
      const headers = ['識別フラグ', '伝票No.', '取引日付', '借方勘定科目', '借方金額', '摘要', '貸方勘定科目'];
      expect(adapter.detectFormat(headers)).toBe(true);
    });

    it('should detect Format B (簡易帳簿) headers', () => {
      const headers = ['日付', '科目', '金額', '摘要', '取引先'];
      expect(adapter.detectFormat(headers)).toBe(true);
    });

    it('should reject non-Yayoi CSV headers', () => {
      const headers = ['Date', 'Amount', 'Description', 'Category'];
      expect(adapter.detectFormat(headers)).toBe(false);
    });

    it('should reject empty headers', () => {
      expect(adapter.detectFormat([])).toBe(false);
    });

    it('should handle headers with extra whitespace', () => {
      const headers = [' 取引日付 ', ' 借方勘定科目 ', ' 借方金額 ', ' 摘要 '];
      expect(adapter.detectFormat(headers)).toBe(true);
    });
  });

  // Format A parsing
  describe('parseRow (Format A)', () => {
    beforeEach(() => {
      adapter.detectFormat(['識別フラグ', '伝票No.', '取引日付', '借方勘定科目', '借方補助科目', '借方金額', '貸方勘定科目', '貸方補助科目', '貸方金額', '摘要', '仕訳メモ']);
    });

    it('should parse a valid Format A row', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/07',
        '借方勘定科目': '通信費',
        '借方補助科目': 'AWS',
        '借方金額': '8,500',
        '貸方勘定科目': '普通預金',
        '貸方補助科目': '',
        '貸方金額': '8,500',
        '摘要': 'AWS クラウド利用料 5月分',
        '仕訳メモ': '',
      };
      const { transaction, skip_reason } = adapter.parseRow(row, 1);
      expect(skip_reason).toBeNull();
      expect(transaction).not.toBeNull();
      expect(transaction!.amount).toBe(8500);
      expect(transaction!.date).toBe('2026-05-07');
      expect(transaction!.memo).toBe('AWS クラウド利用料 5月分');
      expect(transaction!.partner_name).toBe('AWS');
    });

    it('should parse Western date format (2026/05/07)', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/07',
        '借方金額': '1000',
        '貸方金額': '',
        '摘要': 'テスト',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.date).toBe('2026-05-07');
    });

    it('should parse amounts with commas', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/01/15',
        '借方金額': '1,234,567',
        '貸方金額': '',
        '摘要': '大口購入',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.amount).toBe(1234567);
    });

    it('should use absolute value for negative amounts', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/03/01',
        '借方金額': '-5,000',
        '貸方金額': '',
        '摘要': '返金',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.amount).toBe(5000);
    });

    it('should extract partner from 借方補助科目', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/01',
        '借方補助科目': 'スターバックス',
        '借方金額': '500',
        '貸方補助科目': '',
        '貸方金額': '',
        '摘要': 'コーヒー',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.partner_name).toBe('スターバックス');
    });

    it('should skip non-transaction rows (識別フラグ != 2000/2100)', () => {
      const row = {
        '識別フラグ': '1000',
        '取引日付': '2026/05/01',
        '借方金額': '100',
        '貸方金額': '',
        '摘要': 'ヘッダー行',
      };
      const { transaction, skip_reason } = adapter.parseRow(row, 1);
      expect(transaction).toBeNull();
      expect(skip_reason).toContain('非仕訳行');
    });

    it('should skip rows with zero amount', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/01',
        '借方金額': '0',
        '貸方金額': '0',
        '摘要': 'ゼロ金額',
      };
      const { transaction, skip_reason } = adapter.parseRow(row, 1);
      expect(transaction).toBeNull();
      expect(skip_reason).toContain('金額');
    });

    it('should skip rows with empty memo', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/01',
        '借方金額': '1000',
        '貸方金額': '',
        '摘要': '',
      };
      const { transaction, skip_reason } = adapter.parseRow(row, 1);
      expect(transaction).toBeNull();
      expect(skip_reason).toContain('摘要');
    });

    it('should combine 摘要 and 仕訳メモ in memo field', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/01',
        '借方金額': '3000',
        '貸方金額': '',
        '摘要': 'タクシー',
        '仕訳メモ': '渋谷→品川',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.memo).toBe('タクシー 渋谷→品川');
    });

    it('should fall back to 貸方金額 when 借方金額 is empty', () => {
      const row = {
        '識別フラグ': '2000',
        '取引日付': '2026/05/01',
        '借方金額': '',
        '貸方金額': '15000',
        '摘要': '売上入金',
      };
      const { transaction } = adapter.parseRow(row, 1);
      expect(transaction!.amount).toBe(15000);
    });
  });

  // Format B parsing
  describe('parseRow (Format B)', () => {
    beforeEach(() => {
      adapter.detectFormat(['日付', '科目', '金額', '摘要', '取引先']);
    });

    it('should parse a valid Format B row', () => {
      const row = {
        '日付': '2026/05/01',
        '科目': '通信費',
        '金額': '5000',
        '摘要': 'インターネット利用料',
        '取引先': 'NTT',
      };
      const { transaction, skip_reason } = adapter.parseRow(row, 1);
      expect(skip_reason).toBeNull();
      expect(transaction).not.toBeNull();
      expect(transaction!.amount).toBe(5000);
      expect(transaction!.partner_name).toBe('NTT');
    });
  });

  // Source metadata
  it('should have source "yayoi"', () => {
    expect(adapter.source).toBe('yayoi');
  });

  it('should have Japanese label', () => {
    expect(adapter.label).toContain('弥生');
  });
});
