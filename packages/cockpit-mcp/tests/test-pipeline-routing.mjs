// Integration test: classification + exclusion + confidence routing end-to-end.
//
// Uses the real keyword classifier + exclusion checker + confidence router
// (no freee API calls). Validates that the full pipeline decision chain
// produces correct routing actions for all 20 seeded transaction types.

import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';

const keyword = new KeywordClassifier();
const classifier = new TwoStageClassifier(keyword, null); // Stage 2 disabled for unit test
const exclusion = new ExclusionChecker();
const router = new ConfidenceRouter();

// ============================================================
// Test transactions (same as seed-test-data.mjs)
// ============================================================

const TRANSACTIONS = [
  // Stage 1 keyword → high confidence → auto_register
  { memo: 'Suica チャージ 渋谷駅', amount: 3000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'Amazon.co.jp', amount: 12000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'OpenAI subscription', amount: 3000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'スターバックス 渋谷店', amount: 580, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'スターバックス 接待', amount: 15000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 }, // redirected → entertainment
  { memo: 'ANA 羽田-那覇', amount: 42000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: '東京電力 5月分', amount: 8500, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'AWS Cloud monthly', amount: 15000, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'ヤマト運輸 宅急便', amount: 1200, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'クロネコメール便', amount: 360, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },
  { memo: 'タクシー 日本交通', amount: 2800, date: '2026-05-15', expected_action: 'auto_register', expected_stage: 1 },

  // Stage 0 exclusion → human_review
  { memo: 'セブン銀行ATM 出金', amount: 50000, date: '2026-05-15', expected_action: 'human_review', expected_excluded: true },
  { memo: '5月分 給与支給', amount: 350000, date: '2026-05-15', expected_action: 'human_review', expected_excluded: true },
  { memo: '日本政策金融公庫 返済', amount: 100000, date: '2026-05-15', expected_action: 'human_review', expected_excluded: true },
  { memo: '源泉所得税 納付', amount: 45000, date: '2026-05-15', expected_action: 'human_review', expected_excluded: true },
  { memo: '東京水道局 5月分', amount: 3200, date: '2026-05-15', expected_action: 'human_review', expected_excluded: true },

  // Business rule overrides
  { memo: 'Suica チャージ 渋谷駅', amount: 1_200_000, date: '2026-05-15', expected_action: 'human_review', note: 'high amount > 1M' },
  { memo: 'AWS Cloud monthly', amount: 5000, date: '2026-05-03', expected_action: 'human_review', note: 'monthly close period (day 3)' },
  { memo: 'タクシー 日本交通', amount: 2800, date: '2026-05-15', expected_action: 'human_review', note: 'new partner', is_new_partner: true, partner_name: '日本交通' },
];

let passed = 0;
let failed = 0;

console.log('=== Pipeline Routing Integration Test ===\n');
console.log('Memo                          | Amount     | Expected       | Actual         | Match');
console.log('------------------------------|------------|----------------|----------------|------');

for (const tx of TRANSACTIONS) {
  const transaction = { amount: tx.amount, memo: tx.memo, date: tx.date };

  // Step 1: Exclusion
  const exc = exclusion.check(transaction);

  // Step 2: Classification (only if not excluded)
  let cls = null;
  if (!exc.excluded) {
    cls = await classifier.classify(transaction);
  }

  // Step 3: Routing
  const routing = router.route(exc, cls, {
    amount: tx.amount,
    partner_name: tx.partner_name,
    is_new_partner: tx.is_new_partner || false,
    date: tx.date,
  });

  const ok = routing.action === tx.expected_action;
  if (ok) passed++; else failed++;

  // Check stage if expected
  let stageOk = true;
  if (tx.expected_stage && cls) {
    stageOk = cls.stage === tx.expected_stage;
    if (!stageOk) failed++;
    else passed++;
  }
  if (tx.expected_excluded !== undefined) {
    const excOk = exc.excluded === tx.expected_excluded;
    if (!excOk) failed++;
    else passed++;
  }

  const memoCol = tx.memo.padEnd(29).slice(0, 29);
  const amtCol = ('¥' + tx.amount.toLocaleString()).padStart(10);
  const expectedCol = tx.expected_action.padEnd(14);
  const actualCol = routing.action.padEnd(14);
  const mark = ok ? '+' : 'X';
  const note = tx.note ? ` (${tx.note})` : '';

  console.log(`${memoCol} | ${amtCol} | ${expectedCol} | ${actualCol} | ${mark}${note}`);
}

console.log(`\n=== Result: ${passed}/${passed + failed} assertions passed ===`);

if (failed > 0) {
  console.log(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
} else {
  console.log('All pipeline routing tests passed.');
}
