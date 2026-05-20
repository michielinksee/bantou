// Unit + integration tests for CSV import (弥生ブリッジ + freee CSV + generic).
//
// Tests the full pipeline: CSV parse → adapter detection → classification → routing.
// No external API calls (= Stage 2 disabled, no freee API).

import { KeywordClassifier } from '../dist/classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../dist/classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../dist/exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../dist/pipeline/confidence-router.js';
import { importCsv } from '../dist/adapters/index.js';

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
// Test 1: 弥生 Format A (仕訳日記帳 — double entry)
// ============================================================
console.log('\n--- 弥生 Format A (仕訳日記帳) ---');
{
  // Note: dates must be outside monthly close period (day 6+) to avoid human_review flag
  const csv = `識別フラグ,伝票No.,決算,取引日付,借方勘定科目,借方補助科目,借方部門,借方税区分,借方金額,借方税金額,貸方勘定科目,貸方補助科目,貸方部門,貸方税区分,貸方金額,貸方税金額,摘要,番号,期日,タイプ,生成元,仕訳メモ
2000,1,0,2026/05/07,旅費交通費,,,,3000,0,未払金,,,,3000,0,Suica チャージ 渋谷駅,,,,自動取込,
2000,2,0,2026/05/08,通信費,,,,15000,0,普通預金,,,,15000,0,AWS Cloud monthly,,,,自動取込,SaaS費用
2000,3,0,2026/05/10,消耗品費,,,,12000,0,普通預金,,,,12000,0,Amazon.co.jp オフィス用品,,,,手動,
2000,4,0,2026/05/12,旅費交通費,,,,42000,0,普通預金,,,,42000,0,ANA 羽田-那覇,,,,自動取込,出張
2000,5,0,2026/05/15,,,,,50000,0,普通預金,,,,50000,0,セブン銀行ATM 出金,,,,自動取込,`;

  const result = await importCsv(csv, classifier, exclusion, router);

  assert(result.ok, 'import succeeded');
  assert(result.source === 'yayoi', `source detected: ${result.source}`);
  assert(result.source_label === '弥生会計 CSV', `label: ${result.source_label}`);
  assert(result.parsed_count === 5, `parsed 5 rows (got ${result.parsed_count})`);
  assert(result.skipped_count === 0, `0 skipped (got ${result.skipped_count})`);

  // Classification results
  assert(result.summary.auto_register_count >= 3, `auto_register >= 3 (got ${result.summary.auto_register_count})`);
  assert(result.summary.excluded_count >= 1, `excluded >= 1 (got ${result.summary.excluded_count})`);

  // ATM出金 should be excluded
  const atmExcluded = result.excluded.find(ct => ct.transaction.memo.includes('ATM'));
  assert(!!atmExcluded, 'ATM出金 excluded');

  // Suica should be classified as travel (dates are now outside close period)
  const allResults = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review];
  const suica = allResults.find(ct => ct.transaction.memo.includes('Suica'));
  assert(!!suica, 'Suica classified');
  assert(suica?.category_id === 'travel', `Suica → travel (got ${suica?.category_id})`);
  assert(suica?.action === 'auto_register', `Suica → auto_register (got ${suica?.action})`);

  // AWS should be classified as communications
  const aws = allResults.find(ct => ct.transaction.memo.includes('AWS'));
  assert(!!aws, 'AWS classified');
  assert(aws?.category_id === 'communications', `AWS → communications (got ${aws?.category_id})`);

  // Markdown report should exist
  assert(!!result.markdown_report, 'markdown report generated');
  assert(result.markdown_report.includes('CSV Import Report'), 'report has title');

  // CSV output should exist
  assert(!!result.csv_output, 'csv output generated');
  assert(result.csv_output.includes('行番号'), 'csv output has headers');
}

// ============================================================
// Test 2: 弥生 Format B (簡易帳簿 — single entry)
// ============================================================
console.log('\n--- 弥生 Format B (簡易帳簿) ---');
{
  const csv = `日付,科目,金額,摘要,取引先
2026/05/10,旅費交通費,2800,タクシー 日本交通,日本交通
2026/05/12,通信費,3000,OpenAI subscription,OpenAI
2026/05/15,荷造運賃,1200,ヤマト運輸 宅急便,ヤマト運輸`;

  const result = await importCsv(csv, classifier, exclusion, router);

  assert(result.ok, 'import succeeded');
  assert(result.source === 'yayoi', `source detected: ${result.source}`);
  assert(result.parsed_count === 3, `parsed 3 rows (got ${result.parsed_count})`);

  // Taxi should be travel (dates now outside close period)
  const allB = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review];
  const taxi = allB.find(ct => ct.transaction.memo.includes('タクシー'));
  assert(!!taxi, 'Taxi classified');
  assert(taxi?.category_id === 'travel', `Taxi → travel (got ${taxi?.category_id})`);

  // Yamato should be shipping
  const yamato = allB.find(ct => ct.transaction.memo.includes('ヤマト'));
  assert(!!yamato, 'Yamato classified');
  assert(yamato?.category_id === 'shipping', `Yamato → shipping (got ${yamato?.category_id})`);

  // Partner names should be preserved (Format B has 取引先 column)
  assert(taxi?.transaction.partner_name === '日本交通', `partner: ${taxi?.transaction.partner_name}`);
}

// ============================================================
// Test 3: freee CSV export
// ============================================================
console.log('\n--- freee CSV export ---');
{
  const csv = `収支区分,取引日,決済日,取引先,勘定科目,税区分,金額,税額,備考,品目,部門,メモタグ
支出,2026-05-07,,JR東日本,旅費交通費,課対仕入10%,3000,300,Suica チャージ 渋谷駅,,,
支出,2026-05-10,,スターバックス,会議費,課対仕入10%,580,58,スターバックス 渋谷店,,,
支出,2026-05-15,,AWS,通信費,対象外,15000,0,AWS Cloud monthly,,,SaaS`;

  const result = await importCsv(csv, classifier, exclusion, router);

  assert(result.ok, 'import succeeded');
  assert(result.source === 'freee_export', `source detected: ${result.source}`);
  assert(result.parsed_count === 3, `parsed 3 rows (got ${result.parsed_count})`);

  // All should be classified
  const totalAuto = result.summary.auto_register_count + result.summary.auto_register_with_log_count;
  assert(totalAuto === 3, `all 3 auto-classified (got ${totalAuto})`);
}

// ============================================================
// Test 4: Generic CSV with column mapping
// ============================================================
console.log('\n--- Generic CSV ---');
{
  const csv = `Transaction Date,Description,Amount (JPY),Vendor
2026/05/10,Suica チャージ 渋谷駅,3000,JR
2026/05/12,東京電力 5月分,8500,東京電力
2026/05/15,5月分 給与支給,350000,従業員A
2026/05/20,セブン銀行ATM 出金,50000,セブン銀行`;

  const result = await importCsv(csv, classifier, exclusion, router, {
    source: 'generic',
    mapping: {
      date: 'Transaction Date',
      amount: 'Amount (JPY)',
      memo: 'Description',
      partner_name: 'Vendor',
    },
  });

  assert(result.ok, 'import succeeded');
  assert(result.source === 'generic', `source: ${result.source}`);
  assert(result.parsed_count === 4, `parsed 4 rows (got ${result.parsed_count})`);

  // 給与 should be excluded
  const salary = result.excluded.find(ct => ct.transaction.memo.includes('給与'));
  assert(!!salary, '給与 excluded');

  // ATM出金 should be excluded
  const atm = result.excluded.find(ct => ct.transaction.memo.includes('ATM'));
  assert(!!atm, 'ATM出金 excluded');

  // 東京電力 should be classified (= auto_register, not excluded)
  const allClassified = [...result.auto_register, ...result.auto_register_with_log];
  const tepco = allClassified.find(ct => ct.transaction.memo.includes('東京電力'));
  assert(!!tepco, '東京電力 classified (not excluded)');
}

// ============================================================
// Test 5: 和暦 date parsing
// ============================================================
console.log('\n--- 和暦 date parsing ---');
{
  const csv = `日付,科目,金額,摘要
R08/05/15,旅費交通費,3000,Suica チャージ
H28/03/10,通信費,5000,NTT ドコモ`;

  const result = await importCsv(csv, classifier, exclusion, router);

  assert(result.ok, 'import succeeded');
  assert(result.parsed_count === 2, `parsed 2 rows (got ${result.parsed_count})`);

  // R08 = 2026
  const suica = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
    .find(ct => ct.transaction.memo.includes('Suica'));
  assert(suica?.transaction.date === '2026-05-15', `R08 → 2026: ${suica?.transaction.date}`);

  // H28 = 2016
  const ntt = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
    .find(ct => ct.transaction.memo.includes('NTT'));
  assert(ntt?.transaction.date === '2016-03-10', `H28 → 2016: ${ntt?.transaction.date}`);
}

// ============================================================
// Test 6: Empty / malformed CSV
// ============================================================
console.log('\n--- Edge cases ---');
{
  // Empty CSV
  const empty = await importCsv('', classifier, exclusion, router);
  assert(!empty.ok, 'empty CSV → not ok');

  // Header only, no data
  const headerOnly = await importCsv('日付,科目,金額,摘要\n', classifier, exclusion, router);
  assert(!headerOnly.ok, 'header-only CSV → not ok');

  // Unrecognized format (no mapping)
  const unknown = await importCsv('foo,bar,baz\n1,2,3', classifier, exclusion, router);
  assert(!unknown.ok, 'unrecognized format → not ok');
}

// ============================================================
// Test 7: UTF-8 BOM handling
// ============================================================
console.log('\n--- BOM handling ---');
{
  const bom = '﻿日付,科目,金額,摘要\n2026/05/01,旅費交通費,3000,Suica チャージ';
  const result = await importCsv(bom, classifier, exclusion, router);
  assert(result.ok, 'BOM-prefixed CSV parsed correctly');
  assert(result.parsed_count === 1, `parsed 1 row (got ${result.parsed_count})`);
}

// ============================================================
// Test 8: Business rule guards in CSV pipeline
// ============================================================
console.log('\n--- Business rules in CSV ---');
{
  const csv = `日付,科目,金額,摘要
2026/05/15,旅費交通費,1200000,Suica チャージ 渋谷駅
2026/05/03,通信費,5000,AWS Cloud monthly`;

  const result = await importCsv(csv, classifier, exclusion, router);

  // ¥1.2M → human_review (high_amount)
  const highAmount = result.human_review.find(ct => ct.transaction.amount === 1200000);
  assert(!!highAmount, '1.2M → human_review');
  assert(highAmount?.routing_flags.includes('high_amount'), 'flag: high_amount');

  // Day 3 → human_review (monthly_close)
  const closeDay = result.human_review.find(ct => ct.transaction.date === '2026-05-03');
  assert(!!closeDay, 'day 3 → human_review');
  assert(closeDay?.routing_flags.includes('monthly_close_period'), 'flag: monthly_close_period');
}

// ============================================================
// Summary
// ============================================================
console.log(`\n=== CSV Import: ${passed}/${passed + failed} passed ===`);
if (failed > 0) {
  console.log(`FAILED: ${failed} test(s)`);
  process.exit(1);
} else {
  console.log('All CSV import tests passed.');
}
