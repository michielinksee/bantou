// Smoke test for classify_transaction + check_exclusion (= Stage 0 + Stage 1).
//
// Mock transactions covering:
//   - keyword match (= 各 category)
//   - amount threshold redirect (= 会議費 → 交際費)
//   - 7 exclusion rules (= 内容不明デビット / 借入 / 社保 / 給与 / 投資 / ATM / 公共)
//   - no-match (= Stage 2 fallback signal)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = spawn('node', ['../dist/index.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let nextId = 1;

server.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p.resolve(msg); }
    } catch { /* ignore */ }
  }
});

function rpc(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout on ${method}`)); }
    }, 10000);
  });
}

function assert(cond, msg) {
  if (!cond) { console.error(`X FAIL: ${msg}`); process.exit(1); }
  console.log(`+ ${msg}`);
}

async function classify(args) {
  const res = await rpc('tools/call', { name: 'classify_transaction', arguments: args });
  return JSON.parse(res.result.content[0].text);
}

async function checkExc(args) {
  const res = await rpc('tools/call', { name: 'check_exclusion', arguments: args });
  return JSON.parse(res.result.content[0].text);
}

async function run() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1.0' },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // === Classifier tests ===
  console.log('\n=== Classifier tests ===');

  // 1. Travel category
  let r = await classify({ amount: 200, memo: 'Suica チャージ', date: '2026-05-09' });
  assert(r.classified, 'Suica チャージ classified');
  assert(r.category_id === 'travel', `Suica → travel (got: ${r.category_id})`);

  // 2. Consumables
  r = await classify({ amount: 3500, memo: 'Amazon.co.jp', date: '2026-05-09' });
  assert(r.classified, 'Amazon classified');
  assert(r.category_id === 'consumables', `Amazon → consumables (got: ${r.category_id})`);

  // 3. Communications (海外 SaaS)
  r = await classify({ amount: 2200, memo: 'OpenAI subscription', date: '2026-05-09' });
  assert(r.classified, 'OpenAI classified');
  assert(r.category_id === 'communications', `OpenAI → communications (got: ${r.category_id})`);

  // 4. Meeting meal (= ¥10K 以下)
  r = await classify({ amount: 5000, memo: 'スターバックス 渋谷店', date: '2026-05-09' });
  assert(r.classified, 'Starbucks ¥5K classified');
  assert(r.category_id === 'meeting_meal', `Starbucks ¥5K → meeting_meal (got: ${r.category_id})`);

  // 5. Entertainment redirect (= ¥10K 超で 会議費 → 交際費)
  r = await classify({ amount: 15000, memo: 'スターバックス 接待', date: '2026-05-09' });
  assert(r.classified, 'Starbucks ¥15K classified');
  assert(r.amount_override_redirect === 'meeting_meal', `Starbucks ¥15K redirected (got: ${r.amount_override_redirect})`);
  assert(r.category_id === 'entertainment', `redirect target → entertainment (got: ${r.category_id})`);

  // 6. No match (= 不明 memo)
  r = await classify({ amount: 1500, memo: 'xxxyyz unknown vendor', date: '2026-05-09' });
  assert(!r.classified, 'unknown vendor not classified');
  assert(r.confidence === 'none', 'unknown confidence: none');

  // 7. ASCII short-keyword false-positive prevention (= 2026-05-12 bug fix)
  // "ANA" keyword (travel) should NOT match "analytics", "manager", etc.
  r = await classify({ amount: 6800, memo: 'Posthog Cloud (= product analytics SaaS)', date: '2026-05-12' });
  assert(!r.classified, 'Posthog analytics → NOT falsely matched ANA → travel (= word boundary fix)');

  // "AWS" keyword (communications) should match "AWS subscription" but NOT "AWSomething"
  r = await classify({ amount: 5500, memo: 'AWS Cloud monthly', date: '2026-05-12' });
  assert(r.classified, 'AWS legit match');
  assert(r.category_id === 'communications', `AWS → communications (got: ${r.category_id})`);

  // "ANA" should still match real airline usage
  r = await classify({ amount: 35000, memo: 'ANA 羽田-那覇', date: '2026-05-12' });
  assert(r.classified, 'ANA legit match');
  assert(r.category_id === 'travel', `ANA airline → travel (got: ${r.category_id})`);

  // === Exclusion tests ===
  console.log('\n=== Exclusion tests ===');

  // 1. Unknown debit
  let e = await checkExc({ amount: 2000, memo: 'デビット 12345' });
  assert(e.excluded, 'unknown debit excluded');
  assert(e.rule_id === 'unknown_debit', `rule: unknown_debit (got: ${e.rule_id})`);

  // 2. Loan repayment
  e = await checkExc({ amount: 100000, memo: '日本政策金融公庫 返済' });
  assert(e.excluded, '公庫 返済 excluded');
  assert(e.rule_id === 'loan_repayment', `rule: loan_repayment (got: ${e.rule_id})`);

  // 3. Social insurance / tax
  e = await checkExc({ amount: 50000, memo: '源泉所得税 納付' });
  assert(e.excluded, '源泉所得税 excluded');
  assert(e.rule_id === 'social_insurance_tax', `rule: social_insurance_tax (got: ${e.rule_id})`);

  // 4. Salary (keyword)
  e = await checkExc({ amount: 300000, memo: '5月分 給与支給' });
  assert(e.excluded, '給与 excluded');
  assert(e.rule_id === 'salary_payment', `rule: salary_payment (got: ${e.rule_id})`);

  // 5. Investment
  e = await checkExc({ amount: 1000000, memo: '野村證券 株式買付' });
  assert(e.excluded, '野村證券 excluded');
  assert(e.rule_id === 'investment', `rule: investment (got: ${e.rule_id})`);

  // 6. ATM withdrawal
  e = await checkExc({ amount: 50000, memo: 'セブン銀行ATM 出金' });
  assert(e.excluded, 'ATM excluded');
  assert(e.rule_id === 'atm_withdrawal', `rule: atm_withdrawal (got: ${e.rule_id})`);

  // 7. Utilities (公共)
  e = await checkExc({ amount: 8000, memo: '東京水道局 5月分' });
  assert(e.excluded, '水道 excluded');
  assert(e.rule_id === 'utilities', `rule: utilities (got: ${e.rule_id})`);

  // 8. No exclusion (= 通常取引)
  e = await checkExc({ amount: 200, memo: 'Suica チャージ' });
  assert(!e.excluded, 'Suica not excluded');

  console.log('\nAll classify + exclusion smoke tests passed.');
  server.kill();
  process.exit(0);
}

run().catch((e) => {
  console.error('Smoke test errored:', e);
  server.kill();
  process.exit(1);
});
