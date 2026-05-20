// End-to-end integration test: CSV text → full pipeline → classified results.
//
// This test verifies the entire pipeline chain:
//   CSV parse → adapter → exclusion → classifier → tax rules → confidence routing
//
// Uses a minimal in-memory setup (no freee API, no Claude API).

import { describe, it, expect } from 'vitest';
import { importCsv } from '../index.js';
import { KeywordClassifier } from '../../classifier/keyword-classifier.js';
import { TwoStageClassifier } from '../../classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../../exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../../pipeline/confidence-router.js';
import { CockpitMemory } from '../../memory/cockpit-memory.js';
import { TaxRuleEngine } from '../../tax-rules/tax-rule-engine.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, existsSync, unlinkSync } from 'fs';

// ── Test helpers ──────────────────────────────────────────────────

const DATA_DIR = join(__dirname, '../../../../../data');

function makeClassifier() {
  const kw = new KeywordClassifier(
    join(DATA_DIR, 'keyword-dict', 'jp-tax-baseline-v1.json'),
  );
  return new TwoStageClassifier(kw, null); // no Claude API = Stage 1 only
}

function makeExclusion() {
  return new ExclusionChecker(
    join(DATA_DIR, 'exclusion-rules', 'jp-tax-baseline-v1.json'),
  );
}

function makeTaxRuleEngine() {
  return new TaxRuleEngine(undefined, DATA_DIR);
}

const TEST_DIR = join(tmpdir(), 'cockpit-e2e-test-' + process.pid);
const TEST_MEMORY_PATH = join(TEST_DIR, 'memory.json');

function makeMemory() {
  mkdirSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_MEMORY_PATH)) unlinkSync(TEST_MEMORY_PATH);
  return new CockpitMemory(TEST_MEMORY_PATH);
}

// ── Sample CSVs ──────────────────────────────────────────────────

// Generic CSV with common Japanese business transactions
// Dates start from 05-06 to avoid monthly_close_period (1st-5th → human_review override)
const GENERIC_CSV = `日付,金額,摘要,取引先
2026-05-06,8000,AWS クラウド利用料 5月分,Amazon Web Services
2026-05-07,3500,スターバックス 渋谷店 打合せ,スターバックス
2026-05-08,150000,MacBook キーボード修理,ヨドバシカメラ
2026-05-09,500000,弁護士報酬 顧問契約,田中法律事務所
2026-05-10,80000,社宅 家賃 6月分,不動産管理会社
2026-05-11,4000,日経新聞 定期購読,日本経済新聞社
2026-05-12,30000,Google Ads 広告費,Google
2026-05-13,50000,損害保険 年間保険料,東京海上日動
2026-05-14,200,収入印紙,税務署
2026-05-15,10000,商工会議所 年会費,東京商工会議所
2026-05-16,1500,Uber Eats デリバリー 昼食,Uber Eats
2026-05-17,30000,香典 山田部長,慶弔
2026-05-18,5000,寄付金 赤十字,日本赤十字社`;

// ── Tests ─────────────────────────────────────────────────────────

describe('E2E: importCsv full pipeline', () => {
  it('should process a generic CSV through the full pipeline', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        memory: makeMemory(),
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.source).toBe('generic');
    expect(result.parsed_count).toBe(13);
    expect(result.skipped_count).toBe(0);
  });

  it('AWS should be classified as communications with tax_code 0 (overseas SaaS)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const aws = result.auto_register.concat(result.auto_register_with_log, result.human_review)
      .find(ct => ct.transaction.memo.includes('AWS'));

    expect(aws).toBeDefined();
    expect(aws!.category_id).toBe('communications');
    expect(aws!.tax_code).toBe(0); // overseas SaaS override
  });

  it('Starbucks should be classified as meeting_meal', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const starbucks = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('スターバックス'));

    expect(starbucks).toBeDefined();
    expect(starbucks!.category_id).toBe('meeting_meal');
  });

  it('lawyer fee should have withholding tax calculated', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const lawyer = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('弁護士報酬'));

    expect(lawyer).toBeDefined();
    expect(lawyer!.category_id).toBe('professional_fee');
    expect(lawyer!.withholding_amount).toBe(51050); // 500,000 * 10.21%
  });

  it('residential rent should get tax_code 0', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const rent = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('社宅'));

    expect(rent).toBeDefined();
    expect(rent!.category_id).toBe('rent');
    expect(rent!.tax_code).toBe(0); // residential = non-taxable
  });

  it('newspaper should get consumption tax 8% (reduced rate)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const newspaper = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('日経新聞'));

    expect(newspaper).toBeDefined();
    expect(newspaper!.category_id).toBe('books_magazines');
    expect(newspaper!.consumption_tax_rate).toBe(8);
  });

  it('Google Ads should be classified as advertising with tax_code 0 (overseas)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const ads = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('Google Ads'));

    expect(ads).toBeDefined();
    expect(ads!.category_id).toBe('advertising');
    expect(ads!.tax_code).toBe(0); // overseas ad platform
  });

  it('insurance should get tax_code 0 (non-taxable)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const insurance = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('損害保険'));

    expect(insurance).toBeDefined();
    expect(insurance!.category_id).toBe('insurance');
    expect(insurance!.tax_code).toBe(0);
  });

  it('stamp duty should get tax_code 0 (taxes_dues)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const stamp = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('収入印紙'));

    expect(stamp).toBeDefined();
    expect(stamp!.category_id).toBe('taxes_dues');
    expect(stamp!.tax_code).toBe(0);
  });

  it('Uber Eats delivery should get consumption tax 8% (reduced rate)', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const uber = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('Uber Eats'));

    expect(uber).toBeDefined();
    expect(uber!.consumption_tax_rate).toBe(8);
  });

  it('condolence should get tax_code 0', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const condolence = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('香典'));

    expect(condolence).toBeDefined();
    expect(condolence!.category_id).toBe('condolence');
    expect(condolence!.tax_code).toBe(0);
  });

  it('donation should get tax_code 0', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const donation = [...result.auto_register, ...result.auto_register_with_log, ...result.human_review]
      .find(ct => ct.transaction.memo.includes('寄付金'));

    expect(donation).toBeDefined();
    expect(donation!.category_id).toBe('donation');
    expect(donation!.tax_code).toBe(0);
  });

  it('should produce csv_output and markdown_report', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    expect(result.csv_output).toBeDefined();
    expect(result.csv_output).toContain('行番号');
    expect(result.markdown_report).toBeDefined();
    expect(result.markdown_report).toContain('# CSV Import Report');
  });

  it('should have a classification rate above 80%', async () => {
    const result = await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    const rate = parseFloat(result.summary.classification_rate);
    expect(rate).toBeGreaterThan(80);
  });

  it('memory should remember patterns after import', async () => {
    const memory = makeMemory();

    await importCsv(
      GENERIC_CSV,
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
      {
        source: 'generic',
        mapping: { date: '日付', amount: '金額', memo: '摘要', partner_name: '取引先' },
        memory,
        taxRuleEngine: makeTaxRuleEngine(),
      },
    );

    expect(memory.getPatternCount()).toBeGreaterThan(0);
    const stats = memory.getStats();
    expect(stats.total_patterns).toBeGreaterThan(0);

    // Cleanup
    if (existsSync(TEST_MEMORY_PATH)) unlinkSync(TEST_MEMORY_PATH);
  });

  it('empty CSV should return ok=false', async () => {
    const result = await importCsv(
      '',
      makeClassifier(),
      makeExclusion(),
      new ConfidenceRouter(),
    );

    expect(result.ok).toBe(false);
    expect(result.parsed_count).toBe(0);
  });
});
