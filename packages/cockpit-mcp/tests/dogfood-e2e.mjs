// E2E dogfood: tax practitioner workflow simulation.
//
// Simulates a realistic tax accountant workflow WITHOUT freee API:
//
//   Phase 1: 弥生 CSV import (30 transactions, mixed categories)
//   Phase 2: Review classified results (check accuracy)
//   Phase 3: Record corrections (税理士修正フィードバック)
//   Phase 4: Re-import same data → verify corrections apply
//   Phase 5: Import freee CSV for same period → cross-format consistency
//   Phase 6: Generate monthly report
//   Phase 7: Memory stats + persistence check
//
// Expected: Memory learns from Phase 1, corrections override in Phase 4,
// monthly report reflects accurate data.

import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';
import { CockpitMemory } from '../dist/memory/cockpit-memory.js';
import { importCsv } from '../dist/adapters/index.js';
import { generateMonthlyReport } from '../dist/reports/monthly-report.js';

import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, existsSync, readFileSync, unlinkSync, rmdirSync } from 'fs';

// ============================================================
// Setup
// ============================================================

const tmpDir = join(tmpdir(), 'cockpit-dogfood-' + Date.now());
mkdirSync(tmpDir, { recursive: true });
const memoryPath = join(tmpDir, 'memory.json');

const keyword = new KeywordClassifier();
const classifier = new TwoStageClassifier(keyword, null);
const exclusion = new ExclusionChecker();
const router = new ConfidenceRouter();
const memory = new CockpitMemory(memoryPath);

let passed = 0;
let failed = 0;
let warnings = [];

function assert(condition, name, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}` + (detail ? `: ${detail}` : ''));
    failed++;
  }
}
function warn(msg) {
  console.log(`  ⚠ ${msg}`);
  warnings.push(msg);
}

// ============================================================
// Phase 1: 弥生 CSV import — realistic 30-transaction month
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 1: 弥生 CSV import (30 transactions)');
console.log('══════════════════════════════════════════');

const YAYOI_CSV = `識別フラグ,伝票No.,決算,取引日付,借方勘定科目,借方補助科目,借方部門,借方税区分,借方金額,借方税金額,貸方勘定科目,貸方補助科目,貸方部門,貸方税区分,貸方金額,貸方税金額,摘要,番号,期日,タイプ,生成元,仕訳メモ
2000,1,0,2026/05/07,旅費交通費,,,,3000,0,未払金,,,,3000,0,Suica チャージ 渋谷駅,,,,自動取込,
2000,2,0,2026/05/07,通信費,,,,15000,0,普通預金,,,,15000,0,AWS Cloud monthly,,,,自動取込,SaaS
2000,3,0,2026/05/08,消耗品費,,,,8500,0,普通預金,,,,8500,0,Amazon.co.jp オフィス用品,,,,自動取込,
2000,4,0,2026/05/08,旅費交通費,,,,42000,0,普通預金,,,,42000,0,ANA 羽田-那覇 出張,,,,手動,出張
2000,5,0,2026/05/09,会議費,,,,580,0,現金,,,,580,0,スターバックス 渋谷店,,,,手動,
2000,6,0,2026/05/09,水道光熱費,,,,8500,0,普通預金,,,,8500,0,東京電力 5月分,,,,自動取込,
2000,7,0,2026/05/10,荷造運賃,,,,1200,0,普通預金,,,,1200,0,ヤマト運輸 宅急便 送料,,,,自動取込,
2000,8,0,2026/05/10,通信費,,,,3000,0,普通預金,,,,3000,0,OpenAI subscription,,,,自動取込,SaaS
2000,9,0,2026/05/11,旅費交通費,,,,2800,0,現金,,,,2800,0,タクシー 日本交通 六本木,,,,手動,
2000,10,0,2026/05/12,交際費,,,,15000,0,普通預金,,,,15000,0,スターバックス 接待 取引先A,,,,手動,
2000,11,0,2026/05/12,通信費,,,,5000,0,普通預金,,,,5000,0,NTT ドコモ 携帯料金,,,,自動取込,
2000,12,0,2026/05/13,消耗品費,,,,3200,0,現金,,,,3200,0,ダイソー 事務用品,,,,手動,
2000,13,0,2026/05/14,旅費交通費,,,,3000,0,未払金,,,,3000,0,Suica チャージ 新宿駅,,,,自動取込,
2000,14,0,2026/05/14,水道光熱費,,,,4500,0,普通預金,,,,4500,0,東京ガス 5月分,,,,自動取込,
2000,15,0,2026/05/15,荷造運賃,,,,360,0,普通預金,,,,360,0,クロネコメール便 書類発送,,,,自動取込,
2000,16,0,2026/05/15,,,,,50000,0,普通預金,,,,50000,0,セブン銀行ATM 出金,,,,自動取込,
2000,17,0,2026/05/16,通信費,,,,12000,0,普通預金,,,,12000,0,さくらインターネット サーバー費,,,,自動取込,SaaS
2000,18,0,2026/05/17,旅費交通費,,,,680,0,未払金,,,,680,0,PASMO チャージ 東京駅,,,,自動取込,
2000,19,0,2026/05/18,消耗品費,,,,25000,0,普通預金,,,,25000,0,ビックカメラ モニター,,,,手動,
2000,20,0,2026/05/19,会議費,,,,1200,0,現金,,,,1200,0,ドトール 打合せ,,,,手動,
2000,21,0,2026/05/20,旅費交通費,,,,35000,0,普通預金,,,,35000,0,JAL 東京-大阪 出張,,,,手動,出張
2000,22,0,2026/05/20,交際費,,,,8000,0,現金,,,,8000,0,居酒屋 取引先B 会食,,,,手動,
2000,23,0,2026/05/21,通信費,,,,2980,0,普通預金,,,,2980,0,Google Workspace,,,,自動取込,SaaS
2000,24,0,2026/05/22,,,,,350000,0,普通預金,,,,350000,0,5月分 給与支給 山田太郎,,,,自動取込,
2000,25,0,2026/05/23,消耗品費,,,,4800,0,普通預金,,,,4800,0,コクヨ コピー用紙,,,,手動,
2000,26,0,2026/05/24,旅費交通費,,,,3000,0,未払金,,,,3000,0,Suica チャージ 品川駅,,,,自動取込,
2000,27,0,2026/05/25,水道光熱費,,,,6800,0,普通預金,,,,6800,0,東京都水道局 5月分,,,,自動取込,
2000,28,0,2026/05/26,荷造運賃,,,,800,0,普通預金,,,,800,0,佐川急便 宅配便,,,,自動取込,
2000,29,0,2026/05/27,通信費,,,,1500,0,普通預金,,,,1500,0,Zoom Pro monthly,,,,自動取込,SaaS
2000,30,0,2026/05/28,旅費交通費,,,,1800,0,現金,,,,1800,0,タクシー 帝都自動車,,,,手動,`;

const r1 = await importCsv(YAYOI_CSV, classifier, exclusion, router, { memory });

assert(r1.ok, 'import succeeded');
assert(r1.source === 'yayoi', `source: yayoi (got ${r1.source})`);
assert(r1.parsed_count === 30, `parsed 30 rows (got ${r1.parsed_count})`);

// Expected distribution
const autoCount = r1.summary.auto_register_count + r1.summary.auto_register_with_log_count;
const reviewCount = r1.summary.human_review_count;
const excludedCount = r1.summary.excluded_count;

console.log(`\n  Distribution: auto=${autoCount}, review=${reviewCount}, excluded=${excludedCount}`);
assert(autoCount >= 20, `auto >= 20 (got ${autoCount})`);
assert(excludedCount >= 2, `excluded >= 2 (got ${excludedCount})`);

// Specific checks
const excl = r1.excluded;
const atmExcl = excl.find(ct => ct.transaction.memo.includes('ATM'));
assert(!!atmExcl, 'ATM出金 excluded');
const salaryExcl = excl.find(ct => ct.transaction.memo.includes('給与'));
assert(!!salaryExcl, '給与 excluded');

// Category accuracy spot check
const allClassified = [...r1.auto_register, ...r1.auto_register_with_log, ...r1.human_review];

const suicaTx = allClassified.find(ct => ct.transaction.memo.includes('Suica チャージ 渋谷'));
assert(suicaTx?.category_id === 'travel', `Suica → travel (got ${suicaTx?.category_id})`);

const awsTx = allClassified.find(ct => ct.transaction.memo.includes('AWS'));
assert(awsTx?.category_id === 'communications', `AWS → communications (got ${awsTx?.category_id})`);

const anaTx = allClassified.find(ct => ct.transaction.memo.includes('ANA'));
assert(anaTx?.category_id === 'travel', `ANA → travel (got ${anaTx?.category_id})`);

const tepcoTx = allClassified.find(ct => ct.transaction.memo.includes('東京電力'));
assert(tepcoTx?.category_id === 'utilities', `東京電力 → utilities (got ${tepcoTx?.category_id})`);

const yamatoTx = allClassified.find(ct => ct.transaction.memo.includes('ヤマト'));
assert(yamatoTx?.category_id === 'shipping', `ヤマト → shipping (got ${yamatoTx?.category_id})`);

// Memory should have learned
const memStats1 = memory.getStats();
console.log(`\n  Memory after Phase 1: ${memStats1.total_patterns} patterns, ${memStats1.cache_misses} misses`);
assert(memStats1.total_patterns >= 10, `patterns >= 10 (got ${memStats1.total_patterns})`);

// Markdown report
assert(!!r1.markdown_report, 'markdown report generated');
assert(r1.markdown_report.includes('CSV Import Report'), 'report has title');

// CSV output
assert(!!r1.csv_output, 'CSV output generated');
const csvLines = r1.csv_output.split('\n');
assert(csvLines.length >= 25, `CSV output has >= 25 lines (got ${csvLines.length})`);

// ============================================================
// Phase 2: Accuracy review
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 2: Classification accuracy review');
console.log('══════════════════════════════════════════');

// Build accuracy map
const categoryMap = {};
for (const ct of allClassified) {
  const cat = ct.category_name_ja || '未分類';
  categoryMap[cat] = (categoryMap[cat] || 0) + 1;
}
console.log('\n  Category distribution:');
for (const [cat, count] of Object.entries(categoryMap).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${cat}: ${count}`);
}

// Classification rate
const classRate = r1.summary.classification_rate;
console.log(`\n  Classification rate: ${classRate}`);
const rateNum = parseFloat(classRate);
assert(rateNum >= 70, `classification rate >= 70% (got ${classRate})`);

// Check for suspicious misclassifications
const sbuxSmall = allClassified.find(ct => ct.transaction.memo.includes('スターバックス 渋谷店'));
const sbuxBig = allClassified.find(ct => ct.transaction.memo.includes('スターバックス 接待'));
if (sbuxSmall && sbuxBig) {
  console.log(`\n  スターバックス ¥580 → ${sbuxSmall.category_name_ja} (${sbuxSmall.category_id})`);
  console.log(`  スターバックス ¥15,000 → ${sbuxBig.category_name_ja} (${sbuxBig.category_id})`);
  // Both may be classified the same by keyword — that's where corrections come in
}

// ============================================================
// Phase 3: Tax accountant corrections
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 3: Tax accountant corrections');
console.log('══════════════════════════════════════════');

// Correction 1: ドトール → 会議費 (might have been classified differently)
const dotorResult = memory.rememberCorrection({
  memo_pattern: 'ドトール',
  to_category_id: 'meeting',
  to_category_name_ja: '会議費',
  reason: '打合せ利用は会議費',
});
assert(!!dotorResult.id, `correction 1 recorded: ${dotorResult.id}`);
console.log(`  Correction: ドトール → 会議費 (理由: 打合せ利用)`);

// Correction 2: 居酒屋 → 交際費 (verify keyword didn't misclassify)
const izakayaResult = memory.rememberCorrection({
  memo_pattern: '居酒屋',
  to_category_id: 'entertainment',
  to_category_name_ja: '交際費',
  reason: '取引先との会食は交際費',
});
assert(!!izakayaResult.id, `correction 2 recorded: ${izakayaResult.id}`);
console.log(`  Correction: 居酒屋 → 交際費 (理由: 取引先会食)`);

// Correction 3: ビックカメラ モニター → 工具器具備品 (not 消耗品費 — 10万以上は固定資産候補)
memory.rememberCorrection({
  memo_pattern: 'ビックカメラ モニター',
  to_category_id: 'equipment',
  to_category_name_ja: '工具器具備品',
  reason: 'モニター¥25,000は消耗品費だが、税理士判断で備品計上',
});
console.log(`  Correction: ビックカメラ モニター → 工具器具備品 (理由: 税理士判断)`);

const corrections = memory.getCorrections();
assert(corrections.length === 3, `3 corrections active (got ${corrections.length})`);
memory.save();

// ============================================================
// Phase 4: Re-import → verify corrections apply
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 4: Re-import with corrections');
console.log('══════════════════════════════════════════');

// Re-import subset with same patterns
const RECHECK_CSV = `日付,科目,金額,摘要
2026/06/08,会議費,580,スターバックス 渋谷店
2026/06/10,交際費,15000,スターバックス 接待 取引先C
2026/06/12,会議費,1200,ドトール 打合せ
2026/06/15,交際費,12000,居酒屋 取引先D 懇親会
2026/06/18,消耗品費,28000,ビックカメラ モニター アーム`;

const r4 = await importCsv(RECHECK_CSV, classifier, exclusion, router, { memory });
assert(r4.ok, 're-import succeeded');
assert(r4.parsed_count === 5, `parsed 5 rows (got ${r4.parsed_count})`);

const all4 = [...r4.auto_register, ...r4.auto_register_with_log, ...r4.human_review];

// ドトール → should be corrected to 会議費
const dotor4 = all4.find(ct => ct.transaction.memo.includes('ドトール'));
assert(dotor4?.category_id === 'meeting', `ドトール corrected → 会議費 (got ${dotor4?.category_name_ja})`);

// 居酒屋 → should be corrected to 交際費
const izakaya4 = all4.find(ct => ct.transaction.memo.includes('居酒屋'));
assert(izakaya4?.category_id === 'entertainment', `居酒屋 corrected → 交際費 (got ${izakaya4?.category_name_ja})`);

// ビックカメラ モニター → should be corrected to 工具器具備品
const bic4 = all4.find(ct => ct.transaction.memo.includes('ビックカメラ'));
assert(bic4?.category_id === 'equipment', `ビックカメラ corrected → 工具器具備品 (got ${bic4?.category_name_ja})`);

// Memory stats
const memStats4 = memory.getStats();
console.log(`\n  Memory hits: pattern=${memStats4.pattern_hits}, correction=${memStats4.correction_hits}, miss=${memStats4.cache_misses}`);
assert(memStats4.correction_hits >= 3, `correction hits >= 3 (got ${memStats4.correction_hits})`);

// ============================================================
// Phase 5: freee CSV for cross-format consistency
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 5: freee CSV import (cross-format)');
console.log('══════════════════════════════════════════');

const FREEE_CSV = `収支区分,取引日,決済日,取引先,勘定科目,税区分,金額,税額,備考,品目,部門,メモタグ
支出,2026-05-07,,JR東日本,旅費交通費,課対仕入10%,3000,300,Suica チャージ 渋谷駅,,,
支出,2026-05-08,,Amazon,消耗品費,課対仕入10%,8500,850,Amazon.co.jp オフィス用品,,,
支出,2026-05-09,,スターバックス,会議費,課対仕入10%,580,58,スターバックス 渋谷店,,,
支出,2026-05-10,,ヤマト運輸,荷造運賃,課対仕入10%,1200,120,ヤマト運輸 宅急便 送料,,,
支出,2026-05-12,,NTTドコモ,通信費,課対仕入10%,5000,500,NTT ドコモ 携帯料金,,,
支出,2026-05-14,,東京ガス,水道光熱費,課対仕入10%,4500,450,東京ガス 5月分,,,`;

const r5 = await importCsv(FREEE_CSV, classifier, exclusion, router, { memory });
assert(r5.ok, 'freee CSV import ok');
assert(r5.source === 'freee_export', `source: freee_export (got ${r5.source})`);
assert(r5.parsed_count === 6, `parsed 6 rows (got ${r5.parsed_count})`);

// Memory should recall patterns learned from Phase 1 弥生 import
const stats5 = memory.getStats();
console.log(`\n  Memory after freee import: pattern_hits=${stats5.pattern_hits}, total_patterns=${stats5.total_patterns}`);
// The freee CSV has same transaction patterns → should get memory hits
assert(stats5.pattern_hits >= 5, `pattern hits >= 5 across all phases (got ${stats5.pattern_hits})`);

// ============================================================
// Phase 6: Monthly report generation
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 6: Monthly report generation');
console.log('══════════════════════════════════════════');

// Use the Phase 1 classified transactions as input
const mayTransactions = allClassified.map(ct => ({
  amount: ct.transaction.amount,
  memo: ct.transaction.memo,
  date: ct.transaction.date,
  partner_name: ct.transaction.partner_name,
}));

// Also add excluded (for completeness)
for (const ct of r1.excluded) {
  mayTransactions.push({
    amount: ct.transaction.amount,
    memo: ct.transaction.memo,
    date: ct.transaction.date,
    partner_name: ct.transaction.partner_name,
  });
}

const report = await generateMonthlyReport(
  mayTransactions,
  classifier, exclusion, router,
  {
    company_name: '株式会社サンプル',
    month: '2026-05',
  }
);

assert(report.ok, 'report generated');
assert(report.total_transactions === 30, `total: 30 (got ${report.total_transactions})`);
assert(report.company_name === '株式会社サンプル', 'company name correct');
assert(report.month === '2026-05', 'month correct');

// Check categories in report
assert(report.categories.length >= 5, `categories >= 5 (got ${report.categories.length})`);
const travelCat = report.categories.find(c => c.category_id === 'travel');
assert(!!travelCat, 'travel category in report');
assert(travelCat && travelCat.count >= 5, `travel count >= 5 (got ${travelCat?.count})`);

// Anomaly check
console.log(`\n  Anomalies: ${report.anomalies.length}`);
for (const a of report.anomalies) {
  console.log(`    [${a.severity}] ${a.description}`);
}

// Markdown quality
const md = report.markdown || '';
assert(md.includes('株式会社サンプル'), 'markdown has company name');
assert(md.includes('2026年5月'), 'markdown has month');
assert(md.includes('## Summary'), 'markdown has Summary');
assert(md.includes('## Category Breakdown'), 'markdown has Category Breakdown');
assert(md.length > 500, `markdown length > 500 (got ${md.length})`);

console.log(`\n  Report preview (first 500 chars):`);
console.log('  ' + md.slice(0, 500).replace(/\n/g, '\n  '));

// ============================================================
// Phase 7: Memory persistence check
// ============================================================
console.log('\n══════════════════════════════════════════');
console.log('Phase 7: Memory persistence');
console.log('══════════════════════════════════════════');

memory.save();

// Load fresh instance from same file
const memory2 = new CockpitMemory(memoryPath);
const stats7 = memory2.getStats();

assert(stats7.total_patterns >= 10, `persisted patterns >= 10 (got ${stats7.total_patterns})`);
assert(stats7.total_corrections === 3, `persisted corrections: 3 (got ${stats7.total_corrections})`);

// Verify recall still works
const recallTest = memory2.recallPattern({
  amount: 3000, memo: 'Suica チャージ 横浜駅', date: '2026-06-01'
});
assert(recallTest.found, 'Suica pattern survives persistence');
assert(recallTest.pattern?.category_id === 'travel', `persisted Suica → travel (got ${recallTest.pattern?.category_id})`);

// Verify correction survives
const corrTest = memory2.recallPattern({
  amount: 1200, memo: 'ドトール 新橋店', date: '2026-06-01'
});
assert(corrTest.found, 'correction survives persistence');
assert(corrTest.source === 'correction', `correction source (got ${corrTest.source})`);

// Read the actual JSON file
const fileContent = readFileSync(memoryPath, 'utf-8');
const stored = JSON.parse(fileContent);
assert(stored.version === '1.0.0', `store version: 1.0.0 (got ${stored.version})`);
console.log(`\n  Store file size: ${(fileContent.length / 1024).toFixed(1)} KB`);
console.log(`  Patterns: ${stats7.total_patterns}`);
console.log(`  Corrections: ${stats7.total_corrections}`);
console.log(`  Pattern hits: ${stats7.pattern_hits}`);
console.log(`  Correction hits: ${stats7.correction_hits}`);
console.log(`  Cache misses: ${stats7.cache_misses}`);

// ============================================================
// Cleanup + Summary
// ============================================================
try {
  unlinkSync(memoryPath);
  rmdirSync(tmpDir);
} catch {}

console.log('\n══════════════════════════════════════════');
console.log(`E2E Dogfood: ${passed}/${passed + failed} passed`);
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (failed > 0) {
  console.log(`FAILED: ${failed} test(s)`);
  process.exit(1);
} else {
  console.log('All E2E dogfood tests passed.');
  console.log('══════════════════════════════════════════');
}
