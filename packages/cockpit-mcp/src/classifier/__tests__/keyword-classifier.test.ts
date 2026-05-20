import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { KeywordClassifier } from '../keyword-classifier.js';

const DATA_DIR = path.resolve(__dirname, '../../../../../data');

function makeClassifier() {
  return new KeywordClassifier(undefined, DATA_DIR);
}

describe('KeywordClassifier', () => {
  it('should classify a travel keyword (ANA) to travel category', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 50000, memo: 'ANA 国内線チケット', date: '2026-05-01' });
    expect(result.classified).toBe(true);
    expect(result.category_id).toBe('travel');
    expect(result.confidence).toBe('high');
  });

  it('should classify AWS to communications category', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 8000, memo: 'AWS クラウド利用料', date: '2026-05-01' });
    expect(result.classified).toBe(true);
    expect(result.category_id).toBe('communications');
  });

  it('should classify Suica to travel category', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 3000, memo: 'Suica チャージ', date: '2026-05-01' });
    expect(result.classified).toBe(true);
    expect(result.category_id).toBe('travel');
  });

  it('should classify Amazon to consumables category', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 2000, memo: 'Amazon 文房具購入', date: '2026-05-01' });
    expect(result.classified).toBe(true);
    expect(result.category_id).toBe('consumables');
  });

  it('should return classified:false for unknown keywords', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 1000, memo: '不明な取引先XYQZ', date: '2026-05-01' });
    expect(result.classified).toBe(false);
    expect(result.confidence).toBe('none');
  });

  it('should handle empty memo', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 1000, memo: '', date: '2026-05-01' });
    expect(result.classified).toBe(false);
  });

  it('should handle whitespace-only memo', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 1000, memo: '   ', date: '2026-05-01' });
    expect(result.classified).toBe(false);
  });

  it('should be case-insensitive for English keywords', () => {
    const c = makeClassifier();
    const lower = c.classify({ amount: 5000, memo: 'aws tokyo', date: '2026-05-01' });
    const upper = c.classify({ amount: 5000, memo: 'AWS TOKYO', date: '2026-05-01' });
    expect(lower.classified).toBe(true);
    expect(upper.classified).toBe(true);
    expect(lower.category_id).toBe(upper.category_id);
  });

  it('should not false-positive ANA inside "analytics"', () => {
    const c = makeClassifier();
    const result = c.classify({ amount: 5000, memo: 'Posthog Cloud analytics', date: '2026-05-01' });
    // ANA is ASCII-only keyword, so word-boundary matching prevents false positive
    expect(result.category_id).not.toBe('travel');
  });

  it('getCategoriesCount should return 19 categories', () => {
    const c = makeClassifier();
    expect(c.getCategoriesCount()).toBe(19);
  });

  it('getCategoriesMeta should return metadata for all categories', () => {
    const c = makeClassifier();
    const meta = c.getCategoriesMeta();
    expect(meta.length).toBe(19);
    expect(meta[0]).toHaveProperty('id');
    expect(meta[0]).toHaveProperty('name_ja');
    expect(meta[0]).toHaveProperty('freee_account_code');
  });

  it('getKeywordsCount should return a positive number', () => {
    const c = makeClassifier();
    expect(c.getKeywordsCount()).toBeGreaterThan(0);
  });

  it('getVersion should return the dictionary version', () => {
    const c = makeClassifier();
    expect(c.getVersion()).toBe('1.0.0');
  });

  it('should throw when dictionary file is missing', () => {
    expect(() => new KeywordClassifier('/nonexistent/path.json')).toThrow(
      /Keyword dictionary not found/,
    );
  });
});
