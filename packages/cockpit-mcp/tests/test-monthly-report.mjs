// Unit tests for monthly report generation.
//
// Tests the full flow: transactions → classify → aggregate → Markdown report.
// No external API calls (= Stage 2 disabled, no freee API).

import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';
import { generateMonthlyReport } from '../dist/reports/monthly-report.js';

const keyword = new KeywordClassifier();
const classifier = new TwoStageClassifier(keyword, null);
const exclusion = new ExclusionChecker();
const router = new ConfidenceRouter();

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
// Test data: Typical month transactions
// ============================================================
const MAY_TRANSACTIONS = [
  { amount: 3000, memo: 'Suica チャージ 渋谷駅', date: '2026-05-01' },
  { amount: 12000, memo: 'Amazon.co.jp オフィス用品', date: '2026-05-02' },
  { amount: 580, memo: 'スターバックス 渋谷店', date: '2026-05-03' },
  { amount: 15000, memo: 'AWS Cloud monthly', date: '2026-05-05' },
  { amount: 42000, memo: 'ANA 羽田-那覇', date: '2026-05-07' },
  { amount: 8500, memo: '東京電力 5月分', date: '2026-05-10' },
  { amount: 1200, memo: 'ヤマト運輸 宅急便', date: '2026-05-12' },
  { amount: 2800, memo: 'タクシー 日本交通', date: '2026-05-15' },
  { amount: 3000, memo: 'OpenAI subscription', date: '2026-05-15' },
  { amount: 360, memo: 'クロネコメール便', date: '2026-05-18' },
  { amount: 50000, memo: 'セブン銀行ATM 出金', date: '2026-05-20' },
  { amount: 350000, memo: '5月分 給与支給', date: '2026-05-25' },
  { amount: 15000, memo: 'スターバックス 接待', date: '2026-05-28' },
];

const APRIL_TRANSACTIONS = [
  { amount: 3000, memo: 'Suica チャージ 渋谷駅', date: '2026-04-01' },
  { amount: 8000, memo: 'Amazon.co.jp', date: '2026-04-05' },
  { amount: 580, memo: 'スターバックス 渋谷店', date: '2026-04-10' },
  { amount: 15000, memo: 'AWS Cloud monthly', date: '2026-04-15' },
  { amount: 1200, memo: 'ヤマト運輸 宅急便', date: '2026-04-20' },
];

// ============================================================
// Test 1: Basic report generation
// ============================================================
console.log('\n--- Basic report ---');
{
  const result = await generateMonthlyReport(
    MAY_TRANSACTIONS,
    classifier, exclusion, router,
    { company_name: '株式会社テスト', month: '2026-05' }
  );

  assert(result.ok, 'report generated successfully');
  assert(result.total_transactions === 13, `total: ${result.total_transactions}`);
  assert(result.company_name === '株式会社テスト', `company: ${result.company_name}`);
  assert(result.month === '2026-05', `month: ${result.month}`);

  // Should have categories
  assert(result.categories.length > 0, `categories found: ${result.categories.length}`);

  // Travel should be a major category (Suica, ANA, taxi)
  const travel = result.categories.find(c => c.category_id === 'travel');
  assert(!!travel, 'travel category present');
  assert(travel && travel.count >= 3, `travel count >= 3 (got ${travel?.count})`);

  // Should have anomalies (ATM, 給与 are excluded → those show up differently)
  // High amount: ANA ¥42,000 might not trigger (threshold is 500K for anomaly)
  // But excluded items should be tracked

  // Classification rate should be reasonable
  const rateNum = parseFloat(result.classification_rate);
  assert(rateNum > 50, `classification rate > 50% (got ${result.classification_rate})`);

  // Markdown should exist and contain key sections
  assert(!!result.markdown, 'markdown generated');
  assert(result.markdown.includes('株式会社テスト'), 'markdown has company name');
  assert(result.markdown.includes('2026年5月'), 'markdown has month');
  assert(result.markdown.includes('Summary'), 'markdown has summary section');
  assert(result.markdown.includes('Category Breakdown'), 'markdown has category section');
}

// ============================================================
// Test 2: Comparison report
// ============================================================
console.log('\n--- Comparison report ---');
{
  const result = await generateMonthlyReport(
    MAY_TRANSACTIONS,
    classifier, exclusion, router,
    {
      company_name: '比較テスト社',
      month: '2026-05',
      compare_transactions: APRIL_TRANSACTIONS,
      compare_label: '前月',
    }
  );

  assert(result.ok, 'comparison report generated');
  assert(!!result.markdown, 'markdown with comparison');
  assert(result.markdown.includes('前月'), 'markdown has comparison label');
  assert(result.markdown.includes('Change'), 'markdown has change column');
}

// ============================================================
// Test 3: JSON format
// ============================================================
console.log('\n--- JSON format ---');
{
  const result = await generateMonthlyReport(
    MAY_TRANSACTIONS,
    classifier, exclusion, router,
    { month: '2026-05', format: 'json' }
  );

  assert(result.ok, 'json report generated');
  assert(!result.markdown, 'no markdown in json mode');
  assert(result.categories.length > 0, 'categories in json');
}

// ============================================================
// Test 4: Empty transactions
// ============================================================
console.log('\n--- Edge: empty transactions ---');
{
  const result = await generateMonthlyReport(
    [],
    classifier, exclusion, router,
    { month: '2026-05' }
  );

  // Should still succeed but with zeros
  assert(result.ok, 'empty report ok');
  assert(result.total_transactions === 0, 'zero transactions');
  assert(result.classification_rate === '0%', 'rate 0%');
}

// ============================================================
// Test 5: Anomaly detection
// ============================================================
console.log('\n--- Anomaly detection ---');
{
  const highAmountTxns = [
    { amount: 800000, memo: 'AWS Cloud special', date: '2026-05-01' },
    { amount: 150000, memo: '交際費 接待', date: '2026-05-05' },
    { amount: 100000, memo: '交際費 ゴルフ', date: '2026-05-10' },
  ];

  const result = await generateMonthlyReport(
    highAmountTxns,
    classifier, exclusion, router,
    { month: '2026-05' }
  );

  assert(result.ok, 'anomaly report generated');
  assert(result.anomalies.length > 0, `anomalies detected: ${result.anomalies.length}`);

  // ¥800K should trigger high_amount anomaly
  const highAnomaly = result.anomalies.find(a => a.type === 'high_amount');
  assert(!!highAnomaly, 'high_amount anomaly found');
}

// ============================================================
// Test 6: Review items tracking
// ============================================================
console.log('\n--- Review items ---');
{
  const reviewTxns = [
    { amount: 3000, memo: 'Suica チャージ', date: '2026-05-15' }, // should auto
    { amount: 1500000, memo: 'AWS 年間契約', date: '2026-05-15' }, // should review (high amount)
    { amount: 50000, memo: 'セブン銀行ATM 出金', date: '2026-05-15' }, // should exclude
  ];

  const result = await generateMonthlyReport(
    reviewTxns,
    classifier, exclusion, router,
    { month: '2026-05' }
  );

  assert(result.review_items.length >= 1, `review items >= 1 (got ${result.review_items.length})`);

  // High amount should be in review
  const highReview = result.review_items.find(r => r.transaction.amount === 1500000);
  assert(!!highReview, '1.5M in review queue');
}

// ============================================================
// Test 7: Markdown quality checks
// ============================================================
console.log('\n--- Markdown quality ---');
{
  const result = await generateMonthlyReport(
    MAY_TRANSACTIONS,
    classifier, exclusion, router,
    { company_name: 'Markdown品質テスト', month: '2026-05' }
  );

  const md = result.markdown || '';
  // Check structure
  assert(md.includes('# '), 'has H1');
  assert(md.includes('## Summary'), 'has Summary section');
  assert(md.includes('## Category Breakdown'), 'has Category section');
  assert(md.includes('| Metric'), 'has table headers');
  assert(md.includes('Cockpit MCP'), 'has footer attribution');

  // No broken markdown (unclosed tables, etc.)
  const lines = md.split('\n');
  const tableLines = lines.filter(l => l.startsWith('|'));
  for (const tl of tableLines) {
    const pipes = (tl.match(/\|/g) || []).length;
    assert(pipes >= 2, `table line has >= 2 pipes: "${tl.slice(0, 50)}..."`);
  }
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Monthly Report: ${passed}/${passed + failed} passed ===`);
if (failed > 0) {
  console.log(`FAILED: ${failed} test(s)`);
  process.exit(1);
} else {
  console.log('All monthly report tests passed.');
}
