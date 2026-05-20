// freee API seeder for Cockpit dogfood (= Option α).
//
// Posts 20 representative JP SME transactions covering:
//   - Stage 1 keyword categories (各 category 最低 1 件)
//   - Stage 2 海外 SaaS (= Posthog / Linear / Mixpanel / Vercel / Sentry)
//   - Stage 0 exclusion cases (= ATM / 給与 / 公庫 / 公共 / 投資)
//
// Usage:
//   node scripts/seed-test-data.mjs
//
// Pre-requisites:
//   - ~/.claude/secrets/freee-cockpit-dev.json must be valid
//   - packages/cockpit-mcp must be built (`npm run build`)
//
// Behavior:
//   - DRY-RUN by default. Set SEED_FOR_REAL=1 to actually POST.
//   - Reads default account_item_id by fetching /api/1/account_items.
//     Defaults to "未払金" / "雑費" / first available expense account.

import { loadFreeeSecrets } from '../packages/cockpit-mcp/dist/secrets.js';
import { FreeeConnector } from '../packages/cockpit-mcp/dist/connectors/freee.js';

const DRY_RUN = process.env.SEED_FOR_REAL !== '1';

// 20 representative transactions designed to exercise all 3 stages.
// Dates spread across May 2026 to look like a real month.
const SEED_TXS = [
  // === Stage 1 keyword (= 高確度) ===
  { date: '2026-05-02', amount: 200, memo: 'Suica チャージ 渋谷駅', expect: 'stage1:travel' },
  { date: '2026-05-03', amount: 3500, memo: 'Amazon.co.jp', expect: 'stage1:consumables' },
  { date: '2026-05-04', amount: 2200, memo: 'OpenAI subscription', expect: 'stage1:communications' },
  { date: '2026-05-05', amount: 5000, memo: 'スターバックス 渋谷店', expect: 'stage1:meeting_meal' },
  { date: '2026-05-06', amount: 15000, memo: 'スターバックス 接待', expect: 'stage1:entertainment (redirected)' },
  { date: '2026-05-07', amount: 35000, memo: 'ANA 羽田-那覇', expect: 'stage1:travel' },
  { date: '2026-05-08', amount: 12000, memo: '東京電力 5月分', expect: 'exclusion:utilities' },
  { date: '2026-05-09', amount: 8800, memo: 'AWS Cloud monthly', expect: 'stage1:communications' },
  { date: '2026-05-10', amount: 4500, memo: 'ヤマト運輸 宅急便', expect: 'stage1:shipping' },
  { date: '2026-05-11', amount: 980, memo: 'クロネコメール便', expect: 'stage1:shipping' },
  { date: '2026-05-12', amount: 1200, memo: 'タクシー 日本交通', expect: 'stage1:travel' },

  // === Stage 2 Claude (= 海外 SaaS、キーワード辞書外) ===
  { date: '2026-05-13', amount: 6800, memo: 'Posthog Cloud monthly', expect: 'stage2:communications' },
  { date: '2026-05-14', amount: 4500, memo: 'Linear Standard plan', expect: 'stage2:communications' },
  { date: '2026-05-15', amount: 9800, memo: 'Vercel Pro subscription', expect: 'stage2:communications' },
  { date: '2026-05-16', amount: 5500, memo: 'Sentry Team plan', expect: 'stage2:communications' },

  // === Stage 0 exclusion (= 自動分類禁止) ===
  { date: '2026-05-17', amount: 50000, memo: 'セブン銀行ATM 出金', expect: 'exclusion:atm_withdrawal' },
  { date: '2026-05-18', amount: 300000, memo: '5月分 給与支給', expect: 'exclusion:salary_payment' },
  { date: '2026-05-19', amount: 100000, memo: '日本政策金融公庫 返済', expect: 'exclusion:loan_repayment' },
  { date: '2026-05-20', amount: 50000, memo: '源泉所得税 納付', expect: 'exclusion:social_insurance_tax' },
  { date: '2026-05-21', amount: 8000, memo: '東京水道局 5月分', expect: 'exclusion:utilities' },
];

function pickAccountItem(items) {
  // Prefer "未払金" or "雑費" or first available expense account.
  // The classifier overrides this anyway — we only need a valid id to satisfy
  // freee's required field.
  const byName = (name) => items.find((i) => i.name === name && i.available !== false);
  const candidates = ['未払金', '雑費', '消耗品費', '通信費', '旅費交通費'];
  for (const n of candidates) {
    const hit = byName(n);
    if (hit) return hit;
  }
  // Fallback: first available expense-side account
  return items.find((i) => i.available !== false) || items[0];
}

async function main() {
  console.log('=== freee Dogfood Seeder ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (= set SEED_FOR_REAL=1 to POST)' : 'LIVE POST'}`);

  const secrets = loadFreeeSecrets();
  console.log(`Company: ${secrets.company_name} (id=${secrets.company_id})`);
  console.log(`Token expires: ${secrets.token_expires_at}`);
  console.log();

  // Print the plan first so Michie can review even if the token is expired.
  console.log(`Plan: ${SEED_TXS.length} transactions across 3 stages:`);
  for (const t of SEED_TXS) {
    console.log(`  ${t.date}  ¥${String(t.amount).padStart(7)}  "${t.memo}"  → expect: ${t.expect}`);
  }
  console.log();

  if (DRY_RUN) {
    console.log('DRY-RUN: plan above is what would be POSTed. No API call made.');
    console.log('Re-run with SEED_FOR_REAL=1 to actually seed.');
    process.exit(0);
  }

  const freee = new FreeeConnector(secrets);

  // Confirm read access first (= cheap sanity check)
  let company;
  try {
    company = await freee.getCompany();
    console.log(`Verified read access: ${company.display_name}\n`);
  } catch (e) {
    console.error(`FAIL: read sanity check failed (${e?.message || e}).`);
    console.error('Likely cause: freee access token expired (Dev Sandbox tokens = 6h TTL).');
    console.error('Fix: re-issue token at https://developer.freee.co.jp/ and update ~/.claude/secrets/freee-cockpit-dev.json');
    process.exit(1);
  }

  // Get account items
  console.log('Fetching account_items...');
  const items = await freee.listAccountItems();
  console.log(`Got ${items.length} account items.`);

  const defaultItem = pickAccountItem(items);
  if (!defaultItem) {
    console.error('FAIL: no usable account_item found.');
    process.exit(1);
  }
  console.log(`Using default account_item_id=${defaultItem.id} (= "${defaultItem.name}")\n`);

  // LIVE POST mode
  let okCount = 0;
  let failCount = 0;
  const failures = [];

  for (let i = 0; i < SEED_TXS.length; i++) {
    const t = SEED_TXS[i];
    // ref_number: freee 制限 20 chars。 `seed-{epoch10}-NN` = 5+10+1+2 = 18 chars
    const refNumber = `seed-${Math.floor(Date.now() / 1000)}-${String(i + 1).padStart(2, '0')}`;
    try {
      const deal = await freee.createDeal({
        issue_date: t.date,
        type: 'expense',
        amount: t.amount,
        account_item_id: defaultItem.id,
        tax_code: 0,
        ref_number: refNumber,
        description: t.memo,
      });
      okCount++;
      console.log(`  + [${i + 1}/${SEED_TXS.length}] deal_id=${deal.id}  "${t.memo}"`);
    } catch (e) {
      failCount++;
      const msg = e?.message || String(e);
      failures.push({ tx: t, error: msg });
      console.log(`  X [${i + 1}/${SEED_TXS.length}] FAILED  "${t.memo}"  err: ${msg.slice(0, 200)}`);
    }
    // Rate-limit politely (freee allows ~10 req/sec)
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n=== Seed Result ===`);
  console.log(`OK    : ${okCount}`);
  console.log(`FAIL  : ${failCount}`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - "${f.tx.memo}" → ${f.error.slice(0, 200)}`);
    }
  }
  console.log(`\nNext: run \`node packages/cockpit-mcp/tests/smoke-freee-nightly.mjs\` to classify the seeded deals.`);
}

main().catch((e) => {
  console.error('Seeder errored:', e?.message || e);
  process.exit(1);
});
