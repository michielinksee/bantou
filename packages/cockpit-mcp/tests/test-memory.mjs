// Unit tests for CockpitMemory — pattern recall, corrections, and pipeline integration.
//
// Tests the "判断の境界線" flow:
//   "過去パターン一致 → AI 処理 OK、新規 → 確認、修正 → 永続記憶"
//
// No external dependencies (= no freee API, no Linksee MCP).

import { CockpitMemory, makePartnerKey, extractKeywords, amountInRange, isRecent } from '../dist/memory/cockpit-memory.js';
import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';
import { importCsv } from '../dist/adapters/index.js';

import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = join(tmpdir(), 'cockpit-memory-test-' + Date.now());
mkdirSync(tmpDir, { recursive: true });

let passed = 0;
let failed = 0;

function assert(condition, name, detail) {
  if (condition) {
    console.log(`  + ${name}`);
    passed++;
  } else {
    console.log(`  X ${name}` + (detail ? `: ${detail}` : ''));
    failed++;
  }
}

// ============================================================
// Test 1: Helper functions
// ============================================================
console.log('\n--- Helper functions ---');
{
  // makePartnerKey: partner_name priority
  assert(makePartnerKey('スターバックス', 'some memo') === 'スターバックス', 'partner key from name');
  assert(makePartnerKey('株式会社テスト', '') === 'テスト', 'strips 株式会社');
  assert(makePartnerKey('（株）サンプル', '') === 'サンプル', 'strips (株)');
  assert(makePartnerKey('', 'Suica チャージ 渋谷駅') === 'suica_チャージ_渋谷駅', 'partner key from memo');
  assert(makePartnerKey('', '') === '_unknown', 'empty → _unknown');

  // extractKeywords
  const kw = extractKeywords('Suica チャージ 渋谷駅');
  assert(kw.includes('suica'), 'keyword: suica');
  assert(kw.includes('チャージ'), 'keyword: チャージ');
  assert(kw.includes('渋谷駅'), 'keyword: 渋谷駅');

  // amountInRange
  assert(amountInRange(580, 580), '580 ±5% of 580');
  assert(amountInRange(600, 580), '600 ±5% of 580');
  assert(amountInRange(551, 580), '551 ±5% of 580');
  assert(!amountInRange(500, 580), '500 NOT ±5% of 580');
  assert(!amountInRange(700, 580), '700 NOT ±5% of 580');
  assert(amountInRange(100, 0), 'any amount ±5% of 0 (no typical)');

  // isRecent
  const today = new Date().toISOString().slice(0, 10);
  assert(isRecent(today), 'today is recent');
  const twoMonthsAgo = new Date(Date.now() - 60 * 86400 * 1000).toISOString().slice(0, 10);
  assert(isRecent(twoMonthsAgo), '2 months ago is recent');
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400 * 1000).toISOString().slice(0, 10);
  assert(!isRecent(sixMonthsAgo), '6 months ago is NOT recent');
}

// ============================================================
// Test 2: Basic remember + recall
// ============================================================
console.log('\n--- Basic remember + recall ---');
{
  const storePath = join(tmpDir, 'test2.json');
  const mem = new CockpitMemory(storePath);

  const tx = {
    amount: 580,
    memo: 'スターバックス 渋谷店',
    date: '2026-05-15',
    partner_name: 'スターバックス',
  };

  // Before remembering → no pattern
  const before = mem.recallPattern(tx);
  assert(!before.found, 'no pattern before remember');
  assert(before.source === 'none', 'source: none');

  // Remember a classification
  mem.rememberClassification(tx, 'meeting', '会議費', 'high', 'keyword');

  // After remembering → pattern found
  const after = mem.recallPattern(tx);
  assert(after.found, 'pattern found after remember');
  assert(after.source === 'pattern', 'source: pattern');
  assert(after.pattern?.category_id === 'meeting', `category: meeting (got ${after.pattern?.category_id})`);
  assert(after.pattern?.category_name_ja === '会議費', 'category_name_ja: 会議費');
  assert(after.pattern?.match_count >= 1, `match_count >= 1 (got ${after.pattern?.match_count})`);

  // Stats
  const stats = mem.getStats();
  assert(stats.total_patterns === 1, `total_patterns: 1 (got ${stats.total_patterns})`);
  assert(stats.pattern_hits >= 1, `pattern_hits >= 1 (got ${stats.pattern_hits})`);
}

// ============================================================
// Test 3: Correction overrides pattern
// ============================================================
console.log('\n--- Correction overrides pattern ---');
{
  const storePath = join(tmpDir, 'test3.json');
  const mem = new CockpitMemory(storePath);

  const tx = {
    amount: 580,
    memo: 'スターバックス 渋谷店',
    date: '2026-05-15',
    partner_name: 'スターバックス',
  };

  // Remember as 交際費 (wrong)
  mem.rememberClassification(tx, 'entertainment', '交際費', 'high', 'keyword');

  // Verify pattern exists
  const pat = mem.recallPattern(tx);
  assert(pat.found, 'pattern exists');
  assert(pat.pattern?.category_id === 'entertainment', 'pattern: entertainment');

  // Tax accountant corrects: 交際費 → 会議費
  mem.rememberCorrection({
    memo_pattern: 'スターバックス',
    partner_name: 'スターバックス',
    from_category_id: 'entertainment',
    from_category_name_ja: '交際費',
    to_category_id: 'meeting',
    to_category_name_ja: '会議費',
    reason: '1人利用・5,000円以下は会議費',
  });

  // Now recall should return correction, NOT original pattern
  const corrected = mem.recallPattern(tx);
  assert(corrected.found, 'correction found');
  assert(corrected.source === 'correction', `source: correction (got ${corrected.source})`);
  assert(corrected.correction?.to_category_id === 'meeting', 'corrected to: meeting');
  assert(corrected.confidence === 'high', 'correction confidence: high');

  // Stats
  const stats = mem.getStats();
  assert(stats.total_corrections === 1, `corrections: 1 (got ${stats.total_corrections})`);
  assert(stats.correction_hits >= 1, `correction_hits >= 1 (got ${stats.correction_hits})`);
}

// ============================================================
// Test 4: Amount range matching (±5%)
// ============================================================
console.log('\n--- Amount range matching ---');
{
  const storePath = join(tmpDir, 'test4.json');
  const mem = new CockpitMemory(storePath);

  // Remember pattern for ¥580
  mem.rememberClassification(
    { amount: 580, memo: 'スターバックス', date: '2026-05-15', partner_name: 'スターバックス' },
    'meeting', '会議費', 'high', 'keyword'
  );

  // ¥600 (within 5%) → should match
  const within = mem.recallPattern({
    amount: 600, memo: 'スターバックス 新宿店', date: '2026-05-20', partner_name: 'スターバックス'
  });
  assert(within.found, '¥600 matches ¥580 pattern (±5%)');

  // ¥15,000 (way outside) → should NOT match
  const outside = mem.recallPattern({
    amount: 15000, memo: 'スターバックス 接待', date: '2026-05-20', partner_name: 'スターバックス'
  });
  assert(!outside.found, '¥15,000 does NOT match ¥580 pattern');
}

// ============================================================
// Test 5: Multiple patterns per partner (different amounts)
// ============================================================
console.log('\n--- Multiple patterns per partner ---');
{
  const storePath = join(tmpDir, 'test5.json');
  const mem = new CockpitMemory(storePath);

  // Same partner, two different amounts → two different categories
  mem.rememberClassification(
    { amount: 580, memo: 'スターバックス 渋谷', date: '2026-05-15', partner_name: 'スターバックス' },
    'meeting', '会議費', 'high', 'keyword'
  );
  mem.rememberClassification(
    { amount: 15000, memo: 'スターバックス 接待', date: '2026-05-15', partner_name: 'スターバックス' },
    'entertainment', '交際費', 'high', 'keyword'
  );

  assert(mem.getPatternCount() === 2, `2 patterns (got ${mem.getPatternCount()})`);

  // ¥580 → 会議費
  const small = mem.recallPattern({
    amount: 580, memo: 'スターバックス', date: '2026-05-20', partner_name: 'スターバックス'
  });
  assert(small.found && small.pattern?.category_id === 'meeting', '¥580 → 会議費');

  // ¥14,500 → 交際費 (within ±5% of 15000)
  const large = mem.recallPattern({
    amount: 14500, memo: 'スターバックス', date: '2026-05-20', partner_name: 'スターバックス'
  });
  assert(large.found && large.pattern?.category_id === 'entertainment', '¥14,500 → 交際費');
}

// ============================================================
// Test 6: Company-specific correction
// ============================================================
console.log('\n--- Company-specific correction ---');
{
  const storePath = join(tmpDir, 'test6.json');
  const mem = new CockpitMemory(storePath);

  // Remember pattern
  mem.rememberClassification(
    { amount: 3000, memo: 'OpenAI subscription', date: '2026-05-15', partner_name: 'OpenAI', company_id: 100 },
    'communications', '通信費', 'high', 'keyword'
  );

  // Company-specific correction: Company 200 classifies differently
  mem.rememberCorrection({
    memo_pattern: 'OpenAI',
    partner_name: 'OpenAI',
    to_category_id: 'research',
    to_category_name_ja: '研究開発費',
    reason: 'この会社ではAI利用は研究開発費',
    company_id: 200,
  });

  // Company 100 → still uses original pattern (通信費)
  const c100 = mem.recallPattern({
    amount: 3000, memo: 'OpenAI subscription', date: '2026-05-20', partner_name: 'OpenAI', company_id: 100
  });
  assert(c100.found, 'company 100 finds pattern');
  assert(c100.source === 'pattern', 'company 100: pattern (not correction)');
  assert(c100.pattern?.category_id === 'communications', 'company 100 → 通信費');

  // Company 200 → uses correction (研究開発費)
  const c200 = mem.recallPattern({
    amount: 3000, memo: 'OpenAI subscription', date: '2026-05-20', partner_name: 'OpenAI', company_id: 200
  });
  assert(c200.found, 'company 200 finds correction');
  assert(c200.source === 'correction', 'company 200: correction');
  assert(c200.correction?.to_category_id === 'research', 'company 200 → 研究開発費');
}

// ============================================================
// Test 7: Company config
// ============================================================
console.log('\n--- Company config ---');
{
  const storePath = join(tmpDir, 'test7.json');
  const mem = new CockpitMemory(storePath);

  // No config initially
  assert(mem.recallCompanyConfig(100) === null, 'no config initially');

  // Set config
  mem.setCompanyConfig({
    company_id: 100,
    company_name: '慎重株式会社',
    high_amount_threshold: 500000,
    auto_register_min_confidence: 'high',
    notes: '新規顧問先、最初の3ヶ月は慎重運用',
    updated_at: '',
  });

  const config = mem.recallCompanyConfig(100);
  assert(config !== null, 'config set');
  assert(config?.high_amount_threshold === 500000, 'threshold: 500K');
  assert(config?.auto_register_min_confidence === 'high', 'min confidence: high');
}

// ============================================================
// Test 8: Persistence (save + load)
// ============================================================
console.log('\n--- Persistence ---');
{
  const storePath = join(tmpDir, 'test8.json');

  // Create, remember, save
  const mem1 = new CockpitMemory(storePath);
  mem1.rememberClassification(
    { amount: 580, memo: 'スターバックス 渋谷店', date: '2026-05-15', partner_name: 'スターバックス' },
    'meeting', '会議費', 'high', 'keyword'
  );
  mem1.rememberCorrection({
    memo_pattern: 'テスト修正',
    to_category_id: 'misc',
    to_category_name_ja: '雑費',
    reason: 'テスト',
  });
  mem1.save();
  assert(existsSync(storePath), 'file created');

  // Load from disk
  const mem2 = new CockpitMemory(storePath);
  assert(mem2.getPatternCount() >= 1, `patterns loaded: ${mem2.getPatternCount()}`);
  assert(mem2.getCorrectionCount() >= 1, `corrections loaded: ${mem2.getCorrectionCount()}`);

  // Recall from loaded store
  const recall = mem2.recallPattern({
    amount: 580, memo: 'スターバックス 渋谷店', date: '2026-05-20', partner_name: 'スターバックス'
  });
  assert(recall.found, 'pattern survived save/load');
  assert(recall.pattern?.category_id === 'meeting', 'correct category after load');
}

// ============================================================
// Test 9: Memo-based fallback (no partner_name)
// ============================================================
console.log('\n--- Memo-based fallback ---');
{
  const storePath = join(tmpDir, 'test9.json');
  const mem = new CockpitMemory(storePath);

  // Remember without partner_name
  mem.rememberClassification(
    { amount: 3000, memo: 'Suica チャージ 渋谷駅', date: '2026-05-15' },
    'travel', '旅費交通費', 'high', 'keyword'
  );

  // Recall with same keywords, no partner
  const recall = mem.recallPattern({
    amount: 3000, memo: 'Suica チャージ 新宿駅', date: '2026-05-20'
  });
  // Keyword overlap: "suica" + "チャージ" = 2 keywords (enough for match)
  assert(recall.found, 'memo-based pattern found');
  assert(recall.pattern?.category_id === 'travel', 'correct category from memo');
}

// ============================================================
// Test 10: Match count increment
// ============================================================
console.log('\n--- Match count increment ---');
{
  const storePath = join(tmpDir, 'test10.json');
  const mem = new CockpitMemory(storePath);

  const tx = {
    amount: 580,
    memo: 'スターバックス 渋谷店',
    date: '2026-05-15',
    partner_name: 'スターバックス',
  };

  // Remember 5 times
  for (let i = 0; i < 5; i++) {
    mem.rememberClassification(tx, 'meeting', '会議費', 'high', 'keyword');
  }

  const recall = mem.recallPattern(tx);
  assert(recall.found, 'pattern found');
  assert(recall.pattern?.match_count === 5, `match_count: 5 (got ${recall.pattern?.match_count})`);

  // With 5+ matches → confidence is 'high' (threshold is 3)
  assert(recall.confidence === 'high', `confidence: high (got ${recall.confidence})`);
}

// ============================================================
// Test 11: Confidence upgrade based on match count
// ============================================================
console.log('\n--- Confidence from match count ---');
{
  const storePath = join(tmpDir, 'test11.json');
  const mem = new CockpitMemory(storePath);

  const tx = {
    amount: 580,
    memo: 'スターバックス 渋谷店',
    date: '2026-05-15',
    partner_name: 'スターバックス',
  };

  // Remember once → match_count = 1 → medium confidence
  mem.rememberClassification(tx, 'meeting', '会議費', 'high', 'keyword');
  let recall = mem.recallPattern(tx);
  assert(recall.confidence === 'medium', `1 match → medium (got ${recall.confidence})`);

  // Remember 2 more times → match_count = 3 → high confidence
  mem.rememberClassification(tx, 'meeting', '会議費', 'high', 'keyword');
  mem.rememberClassification(tx, 'meeting', '会議費', 'high', 'keyword');
  recall = mem.recallPattern(tx);
  assert(recall.confidence === 'high', `3 matches → high (got ${recall.confidence})`);
}

// ============================================================
// Test 12: CSV pipeline with memory integration
// ============================================================
console.log('\n--- CSV pipeline + memory ---');
{
  const storePath = join(tmpDir, 'test12.json');
  const mem = new CockpitMemory(storePath);
  const keyword = new KeywordClassifier();
  const cls = new TwoStageClassifier(keyword, null);
  const exc = new ExclusionChecker();
  const router = new ConfidenceRouter();

  // First import: memory is empty → normal classification
  const csv1 = `日付,科目,金額,摘要
2026/05/10,旅費交通費,3000,Suica チャージ 渋谷駅
2026/05/12,通信費,15000,AWS Cloud monthly`;

  const result1 = await importCsv(csv1, cls, exc, router, { memory: mem });
  assert(result1.ok, 'first import ok');
  assert(result1.parsed_count === 2, `first import: 2 rows`);

  // Memory should now have patterns
  assert(mem.getPatternCount() >= 1, `patterns after first import: ${mem.getPatternCount()}`);

  // Second import: memory should recall patterns
  const csv2 = `日付,科目,金額,摘要
2026/05/15,旅費交通費,3000,Suica チャージ 新宿駅
2026/05/18,通信費,15000,AWS Cloud monthly`;

  const result2 = await importCsv(csv2, cls, exc, router, { memory: mem });
  assert(result2.ok, 'second import ok');
  assert(result2.parsed_count === 2, `second import: 2 rows`);

  // Stats should show memory hits
  const stats = mem.getStats();
  assert(stats.pattern_hits >= 1, `pattern hits after 2nd import: ${stats.pattern_hits}`);
}

// ============================================================
// Test 13: Correction in CSV pipeline
// ============================================================
console.log('\n--- Correction in CSV pipeline ---');
{
  const storePath = join(tmpDir, 'test13.json');
  const mem = new CockpitMemory(storePath);
  const keyword = new KeywordClassifier();
  const cls = new TwoStageClassifier(keyword, null);
  const exc = new ExclusionChecker();
  const router = new ConfidenceRouter();

  // Register correction: スターバックス → 会議費 (not 交際費)
  mem.rememberCorrection({
    memo_pattern: 'スターバックス',
    partner_name: 'スターバックス',
    to_category_id: 'meeting',
    to_category_name_ja: '会議費',
    reason: '1人利用は会議費',
  });

  // Import with スターバックス → should get corrected category
  const csv = `日付,科目,金額,摘要,取引先
2026/05/15,交際費,580,スターバックス 渋谷店,スターバックス`;

  const result = await importCsv(csv, cls, exc, router, { memory: mem });
  assert(result.ok, 'import with correction ok');

  // Check that the transaction got the corrected category
  const allResults = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review];
  const sbux = allResults.find(ct => ct.transaction.memo.includes('スターバックス'));
  assert(!!sbux, 'スターバックス found in results');
  assert(sbux?.category_id === 'meeting', `corrected to 会議費 (got ${sbux?.category_name_ja})`);
}

// ============================================================
// Test 14: Empty store operations
// ============================================================
console.log('\n--- Empty store ---');
{
  const storePath = join(tmpDir, 'test14.json');
  const mem = new CockpitMemory(storePath);

  assert(mem.getPatternCount() === 0, 'empty: 0 patterns');
  assert(mem.getCorrectionCount() === 0, 'empty: 0 corrections');
  assert(mem.getCorrections().length === 0, 'empty corrections list');
  assert(mem.getPatterns().length === 0, 'empty patterns list');

  const recall = mem.recallPattern({ amount: 100, memo: 'test', date: '2026-05-15' });
  assert(!recall.found, 'empty store: no pattern');
  assert(recall.source === 'none', 'empty store: source none');
}

// ============================================================
// Test 15: getPatterns and getCorrections
// ============================================================
console.log('\n--- List operations ---');
{
  const storePath = join(tmpDir, 'test15.json');
  const mem = new CockpitMemory(storePath);

  mem.rememberClassification(
    { amount: 580, memo: 'スターバックス', date: '2026-05-15', partner_name: 'スターバックス' },
    'meeting', '会議費', 'high', 'keyword'
  );
  mem.rememberClassification(
    { amount: 3000, memo: 'AWS Cloud', date: '2026-05-15', partner_name: 'AWS' },
    'communications', '通信費', 'high', 'keyword'
  );

  const allPatterns = mem.getPatterns();
  assert(allPatterns.length === 2, `all patterns: 2 (got ${allPatterns.length})`);

  const sbuxPatterns = mem.getPatterns('スターバックス');
  assert(sbuxPatterns.length === 1, `sbux patterns: 1 (got ${sbuxPatterns.length})`);

  mem.rememberCorrection({
    memo_pattern: 'test1',
    to_category_id: 'a',
    to_category_name_ja: 'A',
    reason: 'r1',
  });
  mem.rememberCorrection({
    memo_pattern: 'test2',
    to_category_id: 'b',
    to_category_name_ja: 'B',
    reason: 'r2',
  });

  const corrections = mem.getCorrections();
  assert(corrections.length === 2, `corrections: 2 (got ${corrections.length})`);
}

// ============================================================
// Cleanup + Summary
// ============================================================

// Clean up temp files
try {
  const { readdirSync } = await import('fs');
  for (const f of readdirSync(tmpDir)) {
    unlinkSync(join(tmpDir, f));
  }
  const { rmdirSync } = await import('fs');
  rmdirSync(tmpDir);
} catch {}

console.log(`\n=== Memory: ${passed}/${passed + failed} passed ===`);
if (failed > 0) {
  console.log(`FAILED: ${failed} test(s)`);
  process.exit(1);
} else {
  console.log('All memory tests passed.');
}
