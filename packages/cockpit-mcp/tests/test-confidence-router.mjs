// Unit tests for ConfidenceRouter — the decision logic at the heart of
// the practitioner-style nightly pipeline.
//
// Tests verify the CLAUDE.md business rules:
//   1. Stage 0 excluded → human_review
//   2. Unclassified → human_review
//   3. Amount > 1,000,000 → human_review
//   4. New partner → human_review
//   5. Monthly close period (1-5日) → human_review
//   6. High confidence → auto_register
//   7. Medium confidence → auto_register_with_log
//   8. Low confidence → human_review

import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';

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
// Test 1: Stage 0 excluded → human_review
// ============================================================
console.log('\n--- Stage 0 exclusion ---');
{
  const result = router.route(
    { excluded: true, rule_id: 'atm_withdrawal', rule_name_ja: 'ATM出金', reason: '残高調整 workflow へ' },
    null,
    { amount: 50000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'human_review', 'excluded → human_review');
  assert(result.flags.includes('excluded'), 'flag: excluded');
}

// ============================================================
// Test 2: Unclassified → human_review
// ============================================================
console.log('\n--- Unclassified ---');
{
  const result = router.route(
    { excluded: false },
    { classified: false, confidence: 'none', match_reason: 'No match', classifier_version: 'v1' },
    { amount: 5000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'human_review', 'unclassified → human_review');
  assert(result.flags.includes('unclassified'), 'flag: unclassified');
}

// ============================================================
// Test 3: High amount (> 1M) → human_review even with high confidence
// ============================================================
console.log('\n--- High amount ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'communications', category_name_ja: '通信費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 615, tax_code: 0,
    },
    { amount: 1_500_000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'human_review', '1.5M → human_review despite high confidence');
  assert(result.flags.includes('high_amount'), 'flag: high_amount');
}

// ============================================================
// Test 4: Amount exactly at threshold → auto_register (not above)
// ============================================================
console.log('\n--- Amount at threshold ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'communications', category_name_ja: '通信費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 615, tax_code: 0,
    },
    { amount: 1_000_000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'auto_register', '1M exactly → auto_register (not > threshold)');
}

// ============================================================
// Test 5: New partner → human_review even with high confidence
// ============================================================
console.log('\n--- New partner ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'consumables', category_name_ja: '消耗品費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 618, tax_code: 2,
    },
    { amount: 8000, partner_name: '新しい取引先株式会社', is_new_partner: true, date: '2026-05-15' }
  );
  assert(result.action === 'human_review', 'new partner → human_review');
  assert(result.flags.includes('new_partner'), 'flag: new_partner');
}

// ============================================================
// Test 6: Monthly close period (day 3) → human_review
// ============================================================
console.log('\n--- Monthly close period ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'travel', category_name_ja: '旅費交通費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 612, tax_code: 2,
    },
    { amount: 1200, is_new_partner: false, date: '2026-05-03' }
  );
  assert(result.action === 'human_review', 'day 3 → human_review (monthly close)');
  assert(result.flags.includes('monthly_close_period'), 'flag: monthly_close_period');
}

// Day 6 should NOT trigger monthly close
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'travel', category_name_ja: '旅費交通費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 612, tax_code: 2,
    },
    { amount: 1200, is_new_partner: false, date: '2026-05-06' }
  );
  assert(result.action === 'auto_register', 'day 6 → auto_register (outside close period)');
}

// ============================================================
// Test 7: High confidence, no flags → auto_register
// ============================================================
console.log('\n--- High confidence ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'travel', category_name_ja: '旅費交通費',
      confidence: 'high', match_reason: 'Matched keyword "Suica"', classifier_version: 'v1',
      freee_account_code: 612, tax_code: 2, matched_keyword: 'Suica',
    },
    { amount: 3000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'auto_register', 'high confidence → auto_register');
  assert(result.flags.length === 0, 'no flags');
}

// ============================================================
// Test 8: Medium confidence → auto_register_with_log
// ============================================================
console.log('\n--- Medium confidence ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'communications', category_name_ja: '通信費',
      confidence: 'medium', match_reason: 'Stage 2 AI', classifier_version: 'v1',
      freee_account_code: 615, tax_code: 0,
    },
    { amount: 4500, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'auto_register_with_log', 'medium → auto_register_with_log');
  assert(result.flags.includes('medium_confidence'), 'flag: medium_confidence');
}

// ============================================================
// Test 9: Low confidence → human_review
// ============================================================
console.log('\n--- Low confidence ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'consumables', category_name_ja: '消耗品費',
      confidence: 'low', match_reason: 'Stage 2 AI, uncertain', classifier_version: 'v1',
      freee_account_code: 618, tax_code: 2,
    },
    { amount: 12000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result.action === 'human_review', 'low confidence → human_review');
  assert(result.flags.includes('low_confidence'), 'flag: low_confidence');
}

// ============================================================
// Test 10: Multiple flags combined
// ============================================================
console.log('\n--- Multiple flags ---');
{
  const result = router.route(
    { excluded: false },
    {
      classified: true, category_id: 'entertainment', category_name_ja: '交際費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 624, tax_code: 2,
    },
    { amount: 2_000_000, partner_name: '新規接待先', is_new_partner: true, date: '2026-05-02' }
  );
  assert(result.action === 'human_review', 'multiple flags → human_review');
  assert(result.flags.includes('high_amount'), 'flag: high_amount');
  assert(result.flags.includes('new_partner'), 'flag: new_partner');
  assert(result.flags.includes('monthly_close_period'), 'flag: monthly_close_period');
  assert(result.flags.length === 3, `3 flags (got ${result.flags.length})`);
}

// ============================================================
// Test 11: Custom config override
// ============================================================
console.log('\n--- Custom config ---');
{
  const customRouter = new ConfidenceRouter({
    high_amount_threshold: 500_000,
    monthly_close_days: [1, 2, 3],
    monthly_close_override: false, // disable monthly close check
  });

  // 600K should trigger high_amount with 500K threshold
  const result1 = customRouter.route(
    { excluded: false },
    {
      classified: true, category_id: 'travel', category_name_ja: '旅費交通費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 612, tax_code: 2,
    },
    { amount: 600_000, is_new_partner: false, date: '2026-05-15' }
  );
  assert(result1.action === 'human_review', 'custom 500K threshold → human_review at 600K');

  // Day 2 should NOT trigger monthly close (disabled)
  const result2 = customRouter.route(
    { excluded: false },
    {
      classified: true, category_id: 'travel', category_name_ja: '旅費交通費',
      confidence: 'high', match_reason: 'keyword match', classifier_version: 'v1',
      freee_account_code: 612, tax_code: 2,
    },
    { amount: 1200, is_new_partner: false, date: '2026-05-02' }
  );
  assert(result2.action === 'auto_register', 'monthly close disabled → auto_register on day 2');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== Confidence Router: ${passed}/${passed + failed} passed ===`);
if (failed > 0) {
  console.log(`FAILED: ${failed} test(s)`);
  process.exit(1);
} else {
  console.log('All tests passed.');
}
