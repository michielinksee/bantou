import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CockpitMemory, makePartnerKey, extractKeywords, amountInRange, isRecent } from '../cockpit-memory.js';

// Use a temp directory so we never touch production memory
const TEST_DIR = join(tmpdir(), 'cockpit-mcp-test-' + process.pid);
const TEST_STORE = join(TEST_DIR, 'memory.json');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Remove any leftover store from previous test
  if (existsSync(TEST_STORE)) unlinkSync(TEST_STORE);
});

afterEach(() => {
  if (existsSync(TEST_STORE)) unlinkSync(TEST_STORE);
});

describe('CockpitMemory', () => {
  it('should start with empty stats', () => {
    const mem = new CockpitMemory(TEST_STORE);
    const stats = mem.getStats();
    expect(stats.total_patterns).toBe(0);
    expect(stats.total_corrections).toBe(0);
    expect(stats.pattern_hits).toBe(0);
    expect(stats.correction_hits).toBe(0);
    expect(stats.cache_misses).toBe(0);
  });

  it('should remember and recall a classification pattern', () => {
    const mem = new CockpitMemory(TEST_STORE);
    const tx = { amount: 5000, memo: 'AWS 利用料', date: '2026-05-01', partner_name: 'AWS' };
    mem.rememberClassification(tx, 'communications', '通信費', 'high', 'keyword', 615, 2);
    mem.save();

    expect(mem.getPatternCount()).toBe(1);

    const recall = mem.recallPattern(tx);
    expect(recall.found).toBe(true);
    expect(recall.source).toBe('pattern');
    expect(recall.pattern?.category_id).toBe('communications');
  });

  it('should remember and recall a correction (caveat)', () => {
    const mem = new CockpitMemory(TEST_STORE);
    const correction = mem.rememberCorrection({
      memo_pattern: 'スタバ 渋谷',
      partner_name: 'スターバックス',
      from_category_id: 'meeting_meal',
      from_category_name_ja: '会議費',
      to_category_id: 'entertainment',
      to_category_name_ja: '交際費',
      reason: '接待目的のため交際費が正',
    });
    mem.save();

    expect(correction.id).toBeTruthy();
    expect(correction.active).toBe(true);
    expect(mem.getCorrectionCount()).toBe(1);

    // Recall should find the correction
    const tx = { amount: 3000, memo: 'スタバ 渋谷店', date: '2026-05-01', partner_name: 'スターバックス' };
    const recall = mem.recallPattern(tx);
    expect(recall.found).toBe(true);
    expect(recall.source).toBe('correction');
    expect(recall.confidence).toBe('high');
    expect(recall.correction?.to_category_id).toBe('entertainment');
  });

  it('should match patterns by partner key', () => {
    const mem = new CockpitMemory(TEST_STORE);
    const tx1 = { amount: 8000, memo: 'AWS 東京リージョン', date: '2026-05-01', partner_name: 'AWS' };
    mem.rememberClassification(tx1, 'communications', '通信費', 'high', 'keyword');
    mem.save();

    // Same partner, slightly different memo
    const tx2 = { amount: 8200, memo: 'AWS バージニアリージョン', date: '2026-05-10', partner_name: 'AWS' };
    const recall = mem.recallPattern(tx2);
    expect(recall.found).toBe(true);
    expect(recall.pattern?.category_id).toBe('communications');
  });

  it('should respect amount tolerance (+-5%)', () => {
    const mem = new CockpitMemory(TEST_STORE);
    const tx1 = { amount: 10000, memo: 'Slack 月額', date: '2026-05-01', partner_name: 'Slack' };
    mem.rememberClassification(tx1, 'communications', '通信費', 'high', 'keyword');
    mem.save();

    // Within 5% (10,400 is 4% above 10,000)
    const txInRange = { amount: 10400, memo: 'Slack 月額', date: '2026-05-15', partner_name: 'Slack' };
    const recallIn = mem.recallPattern(txInRange);
    expect(recallIn.found).toBe(true);

    // Outside 5% (11,000 is 10% above 10,000)
    const txOutRange = { amount: 11000, memo: 'Slack 月額', date: '2026-05-15', partner_name: 'Slack' };
    const recallOut = mem.recallPattern(txOutRange);
    expect(recallOut.found).toBe(false);
  });

  it('should return correction_hit when a caveat matches', () => {
    const mem = new CockpitMemory(TEST_STORE);
    mem.rememberCorrection({
      memo_pattern: 'タクシー 品川',
      partner_name: 'GOタクシー',
      to_category_id: 'travel',
      to_category_name_ja: '旅費交通費',
      reason: 'テスト修正',
    });

    const tx = { amount: 2000, memo: 'タクシー 品川駅', date: '2026-05-01', partner_name: 'GOタクシー' };
    mem.recallPattern(tx);

    const stats = mem.getStats();
    expect(stats.correction_hits).toBe(1);
  });

  it('should persist and reload from disk', () => {
    const mem1 = new CockpitMemory(TEST_STORE);
    const tx = { amount: 3000, memo: 'Notion 月額', date: '2026-05-01', partner_name: 'Notion' };
    mem1.rememberClassification(tx, 'communications', '通信費', 'high', 'keyword');
    mem1.save();

    // Reload from disk
    const mem2 = new CockpitMemory(TEST_STORE);
    expect(mem2.getPatternCount()).toBe(1);
    const recall = mem2.recallPattern(tx);
    expect(recall.found).toBe(true);
  });

  it('getStats should return correct aggregate counts', () => {
    const mem = new CockpitMemory(TEST_STORE);
    mem.rememberClassification(
      { amount: 1000, memo: 'Test A', date: '2026-05-01', partner_name: 'A' },
      'communications', '通信費', 'high', 'keyword',
    );
    mem.rememberClassification(
      { amount: 2000, memo: 'Test B', date: '2026-05-01', partner_name: 'B' },
      'consumables', '消耗品費', 'high', 'keyword',
    );
    mem.rememberCorrection({
      memo_pattern: 'Test C',
      to_category_id: 'travel',
      to_category_name_ja: '旅費交通費',
      reason: 'test',
    });

    const stats = mem.getStats();
    expect(stats.total_patterns).toBe(3); // 2 classifications + 1 correction-pattern
    expect(stats.total_corrections).toBe(1);
  });
});

// Pure helper function tests
describe('makePartnerKey', () => {
  it('should normalize partner name and remove company suffixes', () => {
    const result = makePartnerKey('株式会社テスト', '');
    expect(result).toBe('テスト');
    const key = makePartnerKey('（株）サンプル', '');
    expect(key).not.toContain('株');
  });

  it('should fall back to memo keywords when partner is empty', () => {
    const key = makePartnerKey('', 'AWS クラウド 利用料');
    expect(key).toBeTruthy();
    expect(key).not.toBe('_unknown');
  });

  it('should return _unknown for empty input', () => {
    expect(makePartnerKey('', '')).toBe('_unknown');
  });
});

describe('extractKeywords', () => {
  it('should extract significant keywords from memo', () => {
    const kws = extractKeywords('AWS クラウド利用料 5月分');
    expect(kws).toContain('aws');
    expect(kws).toContain('クラウド利用料');
  });

  it('should filter out stop words', () => {
    const kws = extractKeywords('from the server');
    expect(kws).not.toContain('from');
    expect(kws).not.toContain('the');
  });

  it('should filter out short words (< 2 chars)', () => {
    const kws = extractKeywords('a b cd ef');
    expect(kws).not.toContain('a');
    expect(kws).not.toContain('b');
    expect(kws).toContain('cd');
    expect(kws).toContain('ef');
  });
});

describe('amountInRange', () => {
  it('should return true for exact match', () => {
    expect(amountInRange(10000, 10000)).toBe(true);
  });

  it('should return true within 5% tolerance', () => {
    expect(amountInRange(10400, 10000)).toBe(true); // +4%
    expect(amountInRange(9600, 10000)).toBe(true);  // -4%
  });

  it('should return false outside 5% tolerance', () => {
    expect(amountInRange(10600, 10000)).toBe(false); // +6%
    expect(amountInRange(9400, 10000)).toBe(false);  // -6%
  });

  it('should return true when typical is 0 (no data yet)', () => {
    expect(amountInRange(5000, 0)).toBe(true);
  });
});

describe('isRecent', () => {
  it('should return true for today', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(isRecent(today)).toBe(true);
  });

  it('should return true for 2 months ago', () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 2);
    expect(isRecent(date.toISOString().slice(0, 10))).toBe(true);
  });

  it('should return false for 4 months ago', () => {
    const date = new Date();
    date.setMonth(date.getMonth() - 4);
    expect(isRecent(date.toISOString().slice(0, 10))).toBe(false);
  });

  it('should return false for invalid date string', () => {
    expect(isRecent('not-a-date')).toBe(false);
  });
});
