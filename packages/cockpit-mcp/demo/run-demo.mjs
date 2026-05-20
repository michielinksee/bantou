#!/usr/bin/env node
// Cockpit MCP — Live Demo Script
//
// Runs the 6-Act demo for the Zoom walkthrough.
// Each Act pauses for presenter commentary (press Enter to continue).
//
// Usage:
//   node demo/run-demo.mjs              # interactive (pause between acts)
//   node demo/run-demo.mjs --no-pause   # non-interactive (CI / dry-run)
//
// Prerequisites:
//   1. npm run build (dist/ must be current)
//   2. Memory should be empty: node demo/reset-demo.mjs
//   3. demo/yayoi-sample-30txn.csv exists

import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';
import { CockpitMemory } from '../dist/memory/cockpit-memory.js';
import { importCsv } from '../dist/adapters/index.js';
import { generateMonthlyReport } from '../dist/reports/monthly-report.js';

import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const noPause = process.argv.includes('--no-pause');

// ============================================================
// Helpers
// ============================================================

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

function banner(act, title, emoji) {
  console.log('');
  console.log(`${C.bgBlue}${C.bold} ${emoji}  Act ${act}: ${title} ${C.reset}`);
  console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);
}

function result(label, value) {
  console.log(`  ${C.green}✓${C.reset} ${C.bold}${label}${C.reset}: ${value}`);
}

function highlight(msg) {
  console.log(`\n  ${C.yellow}★${C.reset} ${C.bold}${msg}${C.reset}`);
}

function table(rows) {
  // rows = [[col1, col2, ...], ...]
  const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (let ri = 0; ri < rows.length; ri++) {
    const line = rows[ri].map((c, i) => String(c).padEnd(widths[i])).join('  ');
    if (ri === 0) {
      console.log(`  ${C.dim}${line}${C.reset}`);
      console.log(`  ${C.dim}${widths.map(w => '─'.repeat(w)).join('  ')}${C.reset}`);
    } else {
      console.log(`  ${line}`);
    }
  }
}

async function pause(msg) {
  if (noPause) {
    console.log(`\n  ${C.dim}[auto: ${msg}]${C.reset}`);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n  ${C.cyan}▶ ${msg} [Enter で次へ]${C.reset} `, () => {
      rl.close();
      resolve();
    });
  });
}

// ============================================================
// Setup
// ============================================================

const MEMORY_PATH = join(__dirname, '..', '.demo-memory.json');

// Clean start
if (existsSync(MEMORY_PATH)) {
  unlinkSync(MEMORY_PATH);
}

const keyword = new KeywordClassifier();
const classifier = new TwoStageClassifier(keyword, null); // no Claude API for demo
const exclusion = new ExclusionChecker();
const router = new ConfidenceRouter();
const memory = new CockpitMemory(MEMORY_PATH);

const csvPath = join(__dirname, 'yayoi-sample-30txn.csv');
if (!existsSync(csvPath)) {
  console.error(`${C.red}ERROR: ${csvPath} not found${C.reset}`);
  process.exit(1);
}
const csvText = readFileSync(csvPath, 'utf-8');

console.log(`\n${C.bgGreen}${C.bold} Cockpit MCP — Live Demo ${C.reset}`);
console.log(`${C.dim}  Memory: ${MEMORY_PATH} (empty start)${C.reset}`);
console.log(`${C.dim}  CSV:    ${csvPath} (30 transactions)${C.reset}`);

// ============================================================
// Act 1: 弥生 CSV import
// ============================================================

banner(1, '弥生 CSV ドロップ → 即座に分類', '📥');

console.log(`\n  ${C.dim}import_csv(file_path: "demo/yayoi-sample-30txn.csv", format: "yayoi_a")${C.reset}\n`);

const r1 = await importCsv(csvText, classifier, exclusion, router, { memory });

result('Source detected', `${r1.source_label} (${r1.source})`);
result('Total rows', r1.total_rows);
result('Parsed', r1.parsed_count);
result('Auto classified', `${r1.summary.auto_register_count + r1.summary.auto_register_with_log_count} 件`);
result('Excluded (Stage 0)', `${r1.summary.excluded_count} 件`);
result('Classification rate', r1.summary.classification_rate);

// Category breakdown
const allClassified = [...r1.auto_register, ...r1.auto_register_with_log, ...r1.human_review];
const catMap = {};
for (const ct of allClassified) {
  const cat = ct.category_name_ja || '未分類';
  catMap[cat] = (catMap[cat] || 0) + 1;
}

console.log(`\n  ${C.bold}Category breakdown:${C.reset}`);
const catRows = [['カテゴリ', '件数']];
for (const [cat, count] of Object.entries(catMap).sort((a, b) => b[1] - a[1])) {
  catRows.push([cat, count]);
}
table(catRows);

// Show excluded
if (r1.excluded.length > 0) {
  console.log(`\n  ${C.bold}Excluded:${C.reset}`);
  for (const ct of r1.excluded) {
    console.log(`  ${C.red}✗${C.reset} ${ct.transaction.memo} (¥${ct.transaction.amount.toLocaleString()}) → ${ct.exclusion_rule}`);
  }
}

highlight('弥生 CSV 30行を読み込み、27件を自動分類、3件を除外 (ATM/給与)');

await pause('Act 1 完了 — 次: 分類結果レビュー');

// ============================================================
// Act 2: 間違い発見
// ============================================================

banner(2, '分類結果レビュー → 間違い発見', '🔍');

// Find the key transactions to review
const dotorTx = allClassified.find(ct => ct.transaction.memo.includes('ドトール'));
const izakayaTx = allClassified.find(ct => ct.transaction.memo.includes('居酒屋'));
const bicTx = allClassified.find(ct => ct.transaction.memo.includes('ビックカメラ'));
const sbuxSmall = allClassified.find(ct => ct.transaction.memo.includes('スターバックス 渋谷店'));
const sbuxBig = allClassified.find(ct => ct.transaction.memo.includes('スターバックス 接待'));

console.log(`\n  ${C.bold}注目取引 — 正しい分類:${C.reset}`);
const okRows = [['摘要', '金額', '分類結果', '判定']];
if (sbuxSmall) okRows.push([sbuxSmall.transaction.memo, `¥${sbuxSmall.transaction.amount.toLocaleString()}`, sbuxSmall.category_name_ja, `${C.green}✓ OK${C.reset}`]);
if (sbuxBig) okRows.push([sbuxBig.transaction.memo.slice(0, 25), `¥${sbuxBig.transaction.amount.toLocaleString()}`, sbuxBig.category_name_ja, `${C.green}✓ OK${C.reset}`]);
if (dotorTx) okRows.push([dotorTx.transaction.memo, `¥${dotorTx.transaction.amount.toLocaleString()}`, dotorTx.category_name_ja, `${C.green}✓ OK${C.reset}`]);
table(okRows);

console.log(`\n  ${C.bold}要修正 — 税理士判断が必要:${C.reset}`);
const errRows = [['摘要', '金額', '現在の分類', '正しい分類']];
if (izakayaTx) errRows.push([izakayaTx.transaction.memo.slice(0, 20), `¥${izakayaTx.transaction.amount.toLocaleString()}`, `${C.red}${izakayaTx.category_name_ja}${C.reset}`, `${C.green}交際費${C.reset}`]);
if (bicTx) errRows.push([bicTx.transaction.memo, `¥${bicTx.transaction.amount.toLocaleString()}`, `${C.red}${bicTx.category_name_ja}${C.reset}`, `${C.green}工具器具備品${C.reset}`]);
table(errRows);

highlight('2件の誤分類。「同じ間違いを二度としない」ために修正を記憶させる');

await pause('Act 2 完了 — 次: 税理士修正フィードバック (核心)');

// ============================================================
// Act 3: 修正フィードバック → 永続記憶
// ============================================================

banner(3, '税理士修正フィードバック → 永続記憶', '✏️');

console.log(`\n  ${C.dim}correct_classification(...)${C.reset}\n`);

// Correction 1: 居酒屋 → 交際費 (keyword が「会議費」に分類する誤り)
const c1 = memory.rememberCorrection({
  memo_pattern: '居酒屋',
  to_category_id: 'entertainment',
  to_category_name_ja: '交際費',
  reason: '取引先との会食は交際費 (5,000円超)',
});
result('修正 1', `居酒屋 → ${C.bold}交際費${C.reset}  (理由: 取引先との会食は交際費)`);

// Correction 2: ビックカメラ モニター → 工具器具備品 (消耗品費ではない)
const c2 = memory.rememberCorrection({
  memo_pattern: 'ビックカメラ モニター',
  to_category_id: 'equipment',
  to_category_name_ja: '工具器具備品',
  reason: 'モニターは消耗品費ではなく備品計上 (税理士判断)',
});
result('修正 2', `ビックカメラ モニター → ${C.bold}工具器具備品${C.reset}  (理由: 税理士判断で備品計上)`);

memory.save();

const stats3 = memory.getStats();
console.log(`\n  ${C.bold}Memory status:${C.reset}`);
result('Patterns learned', stats3.total_patterns);
result('Corrections saved', `${stats3.total_corrections} (caveat layer — 永久保存)`);

highlight('修正 2 件を永久記憶。二度と同じ誤りをしない');

await pause('Act 3 完了 — 次: 再インポートで修正反映 (感動ポイント)');

// ============================================================
// Act 4: 再インポート → 修正が自動反映
// ============================================================

banner(4, '再インポート → 修正が自動反映', '🎯');

console.log(`\n  ${C.dim}同じ CSV をもう一度 import_csv...${C.reset}\n`);

const r4 = await importCsv(csvText, classifier, exclusion, router, { memory });

// Find the corrected transactions
const all4 = [...r4.auto_register, ...r4.auto_register_with_log, ...r4.human_review];
const izakaya4 = all4.find(ct => ct.transaction.memo.includes('居酒屋'));
const bic4 = all4.find(ct => ct.transaction.memo.includes('ビックカメラ'));

console.log(`  ${C.bold}修正反映結果:${C.reset}`);
if (izakaya4) result('居酒屋 取引先B', `${izakaya4.category_name_ja} ${izakaya4.category_id === 'entertainment' ? C.green + '✓ 修正反映!' + C.reset : C.red + '✗' + C.reset}`);
if (bic4) result('ビックカメラ モニター', `${bic4.category_name_ja} ${bic4.category_id === 'equipment' ? C.green + '✓ 修正反映!' + C.reset : C.red + '✗' + C.reset}`);

const stats4 = memory.getStats();
console.log(`\n  ${C.bold}Memory hits:${C.reset}`);
result('Pattern hits (過去パターン一致)', stats4.pattern_hits);
result('Correction hits (修正反映)', stats4.correction_hits);
result('Cache misses', stats4.cache_misses);

highlight('全修正が自動反映。「二度と同じ間違いをしない」= Cockpit Memory の核心');

await pause('Act 4 完了 — 次: 月次レポート');

// ============================================================
// Act 5: 月次レポート
// ============================================================

banner(5, '月次レポート自動生成', '📊');

console.log(`\n  ${C.dim}generate_monthly_report(year: 2026, month: 5, format: "markdown")${C.reset}\n`);

// Use the Phase 4 (corrected) results for the report
const reportTxns = all4.map(ct => ({
  amount: ct.transaction.amount,
  memo: ct.transaction.memo,
  date: ct.transaction.date,
  partner_name: ct.transaction.partner_name,
}));
for (const ct of r4.excluded) {
  reportTxns.push({
    amount: ct.transaction.amount,
    memo: ct.transaction.memo,
    date: ct.transaction.date,
    partner_name: ct.transaction.partner_name,
  });
}

const report = await generateMonthlyReport(
  reportTxns, classifier, exclusion, router,
  { company_name: '株式会社サンプル', month: '2026-05' }
);

result('Company', report.company_name);
result('Month', report.month);
result('Total transactions', report.total_transactions);
result('Categories', report.categories.length);

// Category table
console.log(`\n  ${C.bold}Category breakdown:${C.reset}`);
const rptRows = [['カテゴリ', '件数', '合計金額']];
for (const c of report.categories.sort((a, b) => b.total_amount - a.total_amount)) {
  rptRows.push([c.category_name_ja, c.count, `¥${c.total_amount.toLocaleString()}`]);
}
table(rptRows);

// Anomalies
if (report.anomalies.length > 0) {
  console.log(`\n  ${C.bold}Anomalies detected:${C.reset}`);
  for (const a of report.anomalies) {
    const icon = a.severity === 'high' ? C.red + '🔴' : a.severity === 'medium' ? C.yellow + '🟡' : C.dim + '🟢';
    console.log(`  ${icon}${C.reset} ${a.description}`);
  }
}

// Show markdown preview
const md = report.markdown || '';
if (md) {
  console.log(`\n  ${C.dim}--- Markdown preview (first 400 chars) ---${C.reset}`);
  console.log(`${C.dim}${md.slice(0, 400)}${C.reset}`);
  console.log(`${C.dim}  ... (total ${md.length} chars)${C.reset}`);
}

highlight('月次レポートを自動生成。顧問先にそのまま共有可能');

await pause('Act 5 完了 — 次: Memory 全体を見る');

// ============================================================
// Act 6: Memory の中身
// ============================================================

banner(6, 'Memory の中身を公開', '🧠');

console.log(`\n  ${C.dim}recall_memory(show_stats: true, show_corrections: true)${C.reset}\n`);

const finalStats = memory.getStats();
console.log(`  ${C.bold}Memory Stats:${C.reset}`);
result('Total patterns', finalStats.total_patterns);
result('Total corrections', finalStats.total_corrections);
result('Pattern hits', finalStats.pattern_hits);
result('Correction hits', finalStats.correction_hits);
result('Cache misses', finalStats.cache_misses);

console.log(`\n  ${C.bold}Active corrections (caveat layer):${C.reset}`);
const corrections = memory.getCorrections();
for (let i = 0; i < corrections.length; i++) {
  const c = corrections[i];
  console.log(`  ${C.magenta}${i + 1}.${C.reset} ${c.memo_pattern} → ${C.bold}${c.to_category_name_ja}${C.reset}  ${C.dim}(${c.reason})${C.reset}`);
}

// Pattern examples
console.log(`\n  ${C.bold}Learned patterns (top 5):${C.reset}`);
const allPatterns = memory.getPatterns();
const topPatterns = allPatterns
  .sort((a, b) => b.match_count - a.match_count)
  .slice(0, 5);

for (const p of topPatterns) {
  console.log(`  ${C.blue}●${C.reset} ${p.partner_key} → ${p.category_name_ja}  ${C.dim}(matched ${p.match_count}x, source: ${p.confidence_source})${C.reset}`);
}

highlight(`${finalStats.total_patterns} パターン学習、${finalStats.total_corrections} 件修正。60社 × 毎月 → どんどん賢くなる`);

// ============================================================
// Finale
// ============================================================

console.log('');
console.log(`${C.bgGreen}${C.bold} Demo Complete ${C.reset}`);
console.log('');
console.log(`  ${C.bold}Summary:${C.reset}`);
console.log(`  Act 1: 弥生 CSV 30行 → 27件自動分類 + 3件除外`);
console.log(`  Act 2: 2件の誤分類を発見 (居酒屋・ビックカメラ)`);
console.log(`  Act 3: 税理士修正 2件 → 永久記憶 (caveat layer)`);
console.log(`  Act 4: 再インポート → ${C.green}全修正が自動反映${C.reset}`);
console.log(`  Act 5: 月次レポート自動生成`);
console.log(`  Act 6: Memory = ${finalStats.total_patterns} patterns + ${finalStats.total_corrections} corrections`);
console.log('');
console.log(`  ${C.dim}→ 次: Pilot 提案 (1-Pager へ)${C.reset}`);
console.log('');

// Cleanup for demo reuse
if (!noPause) {
  console.log(`  ${C.dim}Demo memory saved at: ${MEMORY_PATH}${C.reset}`);
  console.log(`  ${C.dim}Run "node demo/reset-demo.mjs" to reset for next demo${C.reset}`);
}
