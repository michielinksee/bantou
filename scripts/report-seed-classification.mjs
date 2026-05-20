// Run classifier + exclusion against the 20 seeded deals and produce a
// readable accuracy report (= what we'd show a tax practitioner).

import { loadFreeeSecrets } from '../packages/cockpit-mcp/dist/secrets.js';
import { FreeeConnector } from '../packages/cockpit-mcp/dist/connectors/freee.js';
import { KeywordClassifier } from '../packages/cockpit-mcp/dist/classifier/keyword-classifier.js';
import { ClaudeClassifier } from '../packages/cockpit-mcp/dist/classifier/claude-classifier.js';
import { TwoStageClassifier } from '../packages/cockpit-mcp/dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../packages/cockpit-mcp/dist/exclusion/exclusion-checker.js';

const EXPECTED = {
  'Suica チャージ 渋谷駅': { stage: 1, category: 'travel' },
  'Amazon.co.jp': { stage: 1, category: 'consumables' },
  'OpenAI subscription': { stage: 1, category: 'communications' },
  'スターバックス 渋谷店': { stage: 1, category: 'meeting_meal' },
  'スターバックス 接待': { stage: 1, category: 'entertainment' }, // redirected from meeting_meal
  'ANA 羽田-那覇': { stage: 1, category: 'travel' },
  '東京電力 5月分': { stage: 1, category: 'utilities' }, // 法人光熱費は Stage 1 (= exclusion は個人光熱費の振替向け)
  'AWS Cloud monthly': { stage: 1, category: 'communications' },
  'ヤマト運輸 宅急便': { stage: 1, category: 'shipping' },
  'クロネコメール便': { stage: 1, category: 'shipping' },
  'タクシー 日本交通': { stage: 1, category: 'travel' },
  'Posthog Cloud monthly': { stage: 2, category: 'communications' },
  'Linear Standard plan': { stage: 2, category: 'communications' },
  'Vercel Pro subscription': { stage: 1, category: 'communications' }, // "Vercel" 既に Stage 1 dict 内 = 期待修正
  'Sentry Team plan': { stage: 2, category: 'communications' },
  'セブン銀行ATM 出金': { stage: 0, rule: 'atm_withdrawal' },
  '5月分 給与支給': { stage: 0, rule: 'salary_payment' },
  '日本政策金融公庫 返済': { stage: 0, rule: 'loan_repayment' },
  '源泉所得税 納付': { stage: 0, rule: 'social_insurance_tax' },
  '東京水道局 5月分': { stage: 0, rule: 'utilities' },
};

async function main() {
  console.log('=== Seeded Deals Classification Report ===\n');
  const s = loadFreeeSecrets();
  const f = new FreeeConnector(s);
  const keyword = new KeywordClassifier();
  const claude = process.env.ANTHROPIC_API_KEY
    ? new ClaudeClassifier(process.env.ANTHROPIC_API_KEY, keyword.getCategoriesMeta())
    : null;
  const classifier = new TwoStageClassifier(keyword, claude);
  const exclusion = new ExclusionChecker();

  console.log(`Stage 1: ${keyword.getCategoriesCount()} categories (v${keyword.getVersion()})`);
  console.log(`Stage 2: ${claude ? `enabled (${claude.getModel()})` : 'DISABLED'}`);
  console.log(`Exclusion: ${exclusion.getRulesCount()} rules (v${exclusion.getVersion()})\n`);

  const deals = await f.listDeals({
    limit: 50,
    start_issue_date: '2026-05-01',
    end_issue_date: '2026-05-31',
  });
  const seeded = deals.filter((d) => d.ref_number && d.ref_number.startsWith('seed-'));
  seeded.sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  console.log(`Found ${seeded.length} seeded deals.\n`);

  let okCount = 0;
  let missCount = 0;
  const misses = [];
  const t0 = Date.now();

  console.log('Date       | Amount    | Memo                       | Result                              | Match');
  console.log('-----------|-----------|----------------------------|-------------------------------------|------');

  for (const d of seeded) {
    const memo = (d.details && d.details[0] && d.details[0].description) || '';
    const tx = { amount: d.amount, memo, date: d.issue_date };
    const exc = exclusion.check(tx);
    let actual;
    if (exc.excluded) {
      actual = { stage: 0, rule: exc.rule_id };
    } else {
      const cls = await classifier.classify(tx);
      actual = cls.classified
        ? { stage: cls.stage, category: cls.category_id, confidence: cls.confidence, kw: cls.matched_keyword }
        : { stage: 'none' };
    }
    const expected = EXPECTED[memo];
    const ok =
      expected &&
      ((expected.stage === 0 && actual.stage === 0 && expected.rule === actual.rule) ||
        (expected.stage > 0 && actual.stage === expected.stage && actual.category === expected.category));

    const memoCol = memo.padEnd(28).slice(0, 28);
    const amtCol = ('¥' + d.amount.toLocaleString()).padStart(9);
    let resultCol;
    if (actual.stage === 0) {
      resultCol = `stage 0 exclusion: ${actual.rule}`;
    } else if (actual.stage === 'none') {
      resultCol = 'UNCLASSIFIED';
    } else {
      resultCol = `stage ${actual.stage}: ${actual.category} (${actual.confidence})`;
    }
    const mark = ok ? '+' : 'X';
    console.log(`${d.issue_date} | ${amtCol} | ${memoCol} | ${resultCol.padEnd(35).slice(0, 35)} | ${mark}`);

    if (ok) okCount++;
    else {
      missCount++;
      misses.push({ memo, expected, actual });
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Result: ${okCount}/${seeded.length} matched expected (${((okCount / seeded.length) * 100).toFixed(0)}%) in ${elapsed}s ===`);

  if (misses.length > 0) {
    console.log('\nMisses:');
    for (const m of misses) {
      console.log(`  - "${m.memo}":`);
      console.log(`    expected: ${JSON.stringify(m.expected)}`);
      console.log(`    actual  : ${JSON.stringify(m.actual)}`);
    }
  }
}

main().catch((e) => {
  console.error('Report errored:', e?.message || e);
  process.exit(1);
});
