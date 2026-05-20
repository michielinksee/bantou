// Smoke test for nightly_run against real freee Dev Sandbox.
// Requires ~/.claude/secrets/freee-cockpit-dev.json to be configured.

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
    }, 180000); // 3 min for nightly_run (Stage 2 API calls)
  });
}

async function run() {
  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-freee', version: '1.0' },
  });
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  console.log('\n=== nightly_run on real freee Dev Sandbox ===');
  const res = await rpc('tools/call', { name: 'nightly_run', arguments: {} });
  const data = JSON.parse(res.result.content[0].text);
  if (!data.ok) {
    console.error('FAILED:', data.error || data);
    process.exit(1);
  }
  console.log(`Company: ${data.company_name} (id=${data.company_id})`);
  console.log(`Total deals fetched: ${data.total_deals}`);
  console.log(`Summary:`);
  console.log(`  Stage 1 classified: ${data.summary.classified_stage1}`);
  console.log(`  Stage 2 classified: ${data.summary.classified_stage2}`);
  console.log(`  excluded          : ${data.summary.excluded}`);
  console.log(`  unclassified      : ${data.summary.unclassified}`);
  console.log(`  confidence high   : ${data.summary.high}`);
  console.log(`  confidence medium : ${data.summary.medium}`);
  console.log(`  confidence low    : ${data.summary.low}`);
  console.log(`  confidence none   : ${data.summary.none}`);
  console.log(`Sample (first 5):`);
  for (const s of data.sample) {
    const stageTag = s.stage ? ` [stage ${s.stage}]` : '';
    console.log(`  - deal ${s.deal_id}: "${s.memo}" → ${s.result}${stageTag}${s.confidence ? ` (${s.confidence})` : ''}${s.rule ? ` [rule:${s.rule}]` : ''}`);
  }
  console.log(`\nClassifier: stage1=${data.classifier?.stage1_version} stage2=${data.classifier?.stage2_model || 'disabled'}`);
  console.log(`Exclusion version : ${data.exclusion_version}`);
  console.log(`Note: ${data.note}`);

  console.log('\nSUCCESS - nightly_run end-to-end working with real freee data');
  server.kill();
  process.exit(0);
}

run().catch((e) => {
  console.error('Smoke test errored:', e);
  server.kill();
  process.exit(1);
});
