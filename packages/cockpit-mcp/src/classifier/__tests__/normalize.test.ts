import { describe, it, expect } from 'vitest';
import { normalizeMemo, normalizeKeywordList } from '../normalize.js';

describe('normalizeMemo', () => {
  it('should convert full-width alphanumeric to half-width', () => {
    expect(normalizeMemo('ＡＢＣ１２３')).toBe('abc123');
  });

  it('should convert full-width space to half-width', () => {
    expect(normalizeMemo('スタバ　コーヒー')).toBe('スタバ コーヒー');
  });

  it('should lowercase English characters', () => {
    expect(normalizeMemo('AWS Tokyo Region')).toBe('aws tokyo region');
  });

  it('should trim leading and trailing whitespace', () => {
    expect(normalizeMemo('  hello  ')).toBe('hello');
  });

  it('should collapse multiple spaces into one', () => {
    expect(normalizeMemo('foo   bar   baz')).toBe('foo bar baz');
  });

  it('should handle empty string', () => {
    expect(normalizeMemo('')).toBe('');
  });

  it('should handle null/undefined input gracefully', () => {
    // normalizeMemo checks !input, so undefined/null should return ''
    expect(normalizeMemo(undefined as unknown as string)).toBe('');
    expect(normalizeMemo(null as unknown as string)).toBe('');
  });

  it('should preserve Japanese text (hiragana, katakana, kanji)', () => {
    expect(normalizeMemo('東京タワー観光')).toBe('東京タワー観光');
  });

  it('should handle mixed full-width and half-width', () => {
    expect(normalizeMemo('Ａmazon　ビジネス 購入')).toBe('amazon ビジネス 購入');
  });
});

describe('normalizeKeywordList', () => {
  it('should normalize each keyword in the list', () => {
    const result = normalizeKeywordList(['ＡＷＳ', 'Amazon', '  suica  ']);
    expect(result).toEqual(['aws', 'amazon', 'suica']);
  });

  it('should return empty array for empty input', () => {
    expect(normalizeKeywordList([])).toEqual([]);
  });
});
