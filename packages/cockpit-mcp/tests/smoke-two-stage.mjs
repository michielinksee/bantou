// Smoke test for two-stage classifier (= Stage 1 + Stage 2).
// Verifies:
//   - Stage 1 still works for keyword-match transactions
//   - Stage 2 fires when Stage 1 has no match
//   - Stage 2 returns reasonable category + confidence
//   - Cost-tracking (= Stage 2 only fires on unknowns)

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const server = spawn('node', ['../dist/index.js'], {
  cwd: __dirname,
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env }, // = pass ANTHROPIC_API_KEY through
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
    }, 30000);
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

async function run() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-two-stage', version: '1.0' },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  // Detect if Stage 2 is enabled (= ANTHROPIC_API_KEY set)
  const stage2Enabled = !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== '';

  // ============================================================
  // Stage 1 (keyword) verification — should always work
  // ============================================================
  console.log('\n=== Stage 1 (keyword match) ===');

  let r = await classify({ amount: 200, memo: 'Suica チャージ', date: '2026-05-11' });
  assert(r.classified, 'Suica チャージ classified');
  assert(r.stage === 1, `Stage 1 match (got: stage=${r.stage})`);
  assert(r.category_id === 'travel', `Stage 1 → travel (got: ${r.category_id})`);

  r = await classify({ amount: 5000, memo: 'スターバックス 渋谷店', date: '2026-05-11' });
  assert(r.classified, 'Starbucks classified');
  assert(r.stage === 1, `Stage 1 match (got: stage=${r.stage})`);

  r = await classify({ amount: 3500, memo: 'Amazon.co.jp', date: '2026-05-11' });
  assert(r.classified, 'Amazon classified');
  assert(r.stage === 1, `Stage 1 match (got: stage=${r.stage})`);
  assert(r.category_id === 'consumables', `Amazon → consumables (got: ${r.category_id})`);

  // ============================================================
  // No-match behavior (= Stage 2 disabled OR enabled)
  // ============================================================
  if (stage2Enabled) {
    console.log('\n=== Stage 2 (Claude API fallback) — ENABLED ===');

    // Truly unknown vendor → Stage 2 should classify
    r = await classify({
      amount: 6800,
      memo: 'Posthog Cloud (= product analytics SaaS)',
      date: '2026-05-11',
    });
    console.log('  Stage 2 result (Posthog):', JSON.stringify({
      classified: r.classified,
      stage: r.stage,
      category: r.category_id,
      confidence: r.confidence,
      reason: r.match_reason?.slice(0, 100),
    }, null, 2));
    assert(r.classified, 'Posthog classified by Stage 2');
    assert(r.stage === 2, `Stage 2 match (got: stage=${r.stage})`);
    assert(['communications', 'consumables'].includes(r.category_id), `Posthog → reasonable category (got: ${r.category_id})`);

    r = await classify({
      amount: 3300,
      memo: 'Linear Pro 月額 (= プロジェクト管理 SaaS)',
      date: '2026-05-11',
    });
    console.log('  Stage 2 result (Linear):', JSON.stringify({
      classified: r.classified,
      stage: r.stage,
      category: r.category_id,
      confidence: r.confidence,
    }, null, 2));
    assert(r.classified, 'Linear Pro classified by Stage 2');

  } else {
    console.log('\n=== Stage 2 SKIPPED (ANTHROPIC_API_KEY not set) ===');
    console.log('  To enable Stage 2: export ANTHROPIC_API_KEY=sk-ant-xxx');
    console.log('  Cofounder sandbox 環境では key 露出されないため、 これは expected behavior');

    // Verify that Stage 2 disabled → unclassified for unknown vendor
    r = await classify({
      amount: 6800,
      memo: 'Posthog Cloud (= unknown SaaS)',
      date: '2026-05-11',
    });
    assert(!r.classified, 'Unknown vendor unclassified (Stage 2 disabled)');
    assert(r.stage === 'unclassified', `stage = unclassified (got: ${r.stage})`);
  }

  console.log('\nAll two-stage smoke tests passed.');
  console.log(`  Stage 2 status: ${stage2Enabled ? 'tested with real API' : 'skipped (no API key)'}`);
  server.kill();
  process.exit(0);
}

run().catch((e) => {
  console.error('Smoke test errored:', e);
  server.kill();
  process.exit(1);
});
