import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { TaxRuleEngine } from '../tax-rule-engine.js';
import type { Transaction, ClassificationResult } from '../../classifier/types.js';

const DATA_DIR = path.resolve(__dirname, '../../../../../data');

function makeEngine() {
  return new TaxRuleEngine(undefined, DATA_DIR);
}

/** Helper — build a minimal ClassificationResult */
function classified(
  overrides: Partial<ClassificationResult> & { category_id: string },
): ClassificationResult {
  return {
    classified: true,
    confidence: 'high',
    match_reason: 'test',
    classifier_version: '1.0.0',
    tax_code: 2,
    ...overrides,
  };
}

function tx(amount: number, memo: string, date?: string): Transaction {
  return { amount, memo, date: date || '2026-05-01' };
}

// ── Overseas SaaS tax-code override ────────────────────────────────

describe('resolveOverseasSaasTaxCode', () => {
  it('AWS → tax_code 0 (overseas SaaS, 対象外)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(8000, 'AWS クラウド利用料'),
      classified({ category_id: 'communications', matched_keyword: 'AWS' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.tax_code_reason).toContain('海外SaaS');
    expect(result.consumption_tax_rate).toBe(0);
  });

  it('Anthropic → tax_code 0', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, 'Anthropic API利用料'),
      classified({ category_id: 'communications', matched_keyword: 'Anthropic' }),
    );
    expect(result.tax_code_override).toBe(0);
  });

  it('Vercel → tax_code 0', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(3000, 'Vercel Pro Plan'),
      classified({ category_id: 'communications', matched_keyword: 'Vercel' }),
    );
    expect(result.tax_code_override).toBe(0);
  });

  it('ドコモ → tax_code NOT overridden (domestic)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(12000, 'ドコモ 携帯利用料'),
      classified({ category_id: 'communications', matched_keyword: 'ドコモ' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });

  it('NTT → tax_code NOT overridden (domestic)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5500, 'NTT フレッツ光 月額'),
      classified({ category_id: 'communications', matched_keyword: 'NTT' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });

  it('さくらインターネット → tax_code NOT overridden (domestic)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(1000, 'さくらインターネット VPS'),
      classified({ category_id: 'communications', matched_keyword: 'さくらインターネット' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });

  it('overseas SaaS with JCT indicator → keep tax_code 2', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(8000, 'AWS クラウド利用料 消費税込'),
      classified({ category_id: 'communications', matched_keyword: 'AWS' }),
    );
    expect(result.tax_code_override).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('JCT');
  });

  it('overseas SaaS with インボイス indicator → keep tax_code 2', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, 'GitHub インボイス対応済'),
      classified({ category_id: 'communications', matched_keyword: 'GitHub' }),
    );
    expect(result.tax_code_override).toBeUndefined();
    expect(result.warnings[0]).toContain('インボイス');
  });

  it('non-communications category → no override', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, 'AWS 書籍購入'),
      classified({ category_id: 'books_magazines', matched_keyword: 'AWS' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });
});

// ── Overseas advertising tax-code override (Tier 2) ──────────────

describe('resolveOverseasAdTaxCode', () => {
  it('Google Ads → tax_code 0 (overseas ad platform)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(50000, 'Google Ads 広告費'),
      classified({ category_id: 'advertising', matched_keyword: 'Google Ads' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.tax_code_reason).toContain('海外広告');
    expect(result.consumption_tax_rate).toBe(0);
  });

  it('Meta (Facebook Ads) → tax_code 0', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(30000, 'Meta 広告出稿'),
      classified({ category_id: 'advertising', matched_keyword: 'Meta' }),
    );
    expect(result.tax_code_override).toBe(0);
  });

  it('LinkedIn Ads → tax_code 0', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(20000, 'LinkedIn Ads キャンペーン'),
      classified({ category_id: 'advertising', matched_keyword: 'LinkedIn Ads' }),
    );
    expect(result.tax_code_override).toBe(0);
  });

  it('Yahoo!広告 → NOT overridden (domestic)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(40000, 'Yahoo!広告 リスティング'),
      classified({ category_id: 'advertising', matched_keyword: 'Yahoo!広告' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });

  it('LINE広告 → NOT overridden (domestic)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(25000, 'LINE広告 配信'),
      classified({ category_id: 'advertising', matched_keyword: 'LINE広告' }),
    );
    expect(result.tax_code_override).toBeUndefined();
  });

  it('overseas ad with JCT → keep tax_code 2', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(50000, 'Google Ads 消費税込み'),
      classified({ category_id: 'advertising', matched_keyword: 'Google Ads' }),
    );
    expect(result.tax_code_override).toBeUndefined();
    expect(result.warnings[0]).toContain('海外広告');
  });

  it('non-advertising category → no ad override', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, 'Google Cloud 利用料'),
      classified({ category_id: 'communications', matched_keyword: 'Google Cloud' }),
    );
    // Should be handled by overseas SaaS, not overseas ads
    expect(result.tax_code_reason).toContain('海外SaaS');
  });
});

// ── Non-taxable categories (Tier 2) ──────────────────────────────

describe('resolveNonTaxableCategory', () => {
  it('insurance → tax_code 0 (非課税)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(50000, '損害保険 月額'),
      classified({ category_id: 'insurance' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_rate).toBe(0);
    expect(result.consumption_tax_reason).toContain('保険料');
  });

  it('taxes_dues → tax_code 0 (不課税)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(200, '収入印紙'),
      classified({ category_id: 'taxes_dues' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_reason).toContain('租税公課');
  });

  it('donation → tax_code 0 (不課税)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(10000, '日本赤十字 寄付金'),
      classified({ category_id: 'donation' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_reason).toContain('寄付金');
  });

  it('condolence → tax_code 0 (不課税)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(30000, '香典 山田様'),
      classified({ category_id: 'condolence' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_reason).toContain('慶弔費');
  });

  it('salary → tax_code 0 (handled by non-taxable bulk)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(300000, '給与 月額'),
      classified({ category_id: 'salary' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_rate).toBe(0);
  });

  it('membership_fee → tax_code 0 (handled by non-taxable bulk)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(10000, '商工会議所 年会費'),
      classified({ category_id: 'membership_fee' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_rate).toBe(0);
  });

  it('non-taxable category skips all other rules', () => {
    const engine = makeEngine();
    // Even if a category like insurance had an amount > 300K, no asset check
    const result = engine.applyRules(
      tx(500000, '年間保険料一括払い'),
      classified({ category_id: 'insurance' }),
    );
    expect(result.tax_code_override).toBe(0);
    expect(result.asset_tier).toBeUndefined(); // no asset check
    expect(result.withholding).toBeUndefined(); // no withholding check
  });
});

// ── Asset capitalisation tiers ─────────────────────────────────────

describe('resolveAssetCapitalization', () => {
  it('50,000 yen → expense tier (OK as-is)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(50000, 'Amazon モニター購入'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('expense');
    expect(result.asset_warning).toBeUndefined();
  });

  it('99,999 yen → expense tier (boundary)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(99999, 'ヨドバシ キーボード'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('expense');
    expect(result.asset_warning).toBeUndefined();
  });

  it('100,000 yen → lump_sum_3yr tier (boundary)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(100000, 'Amazon ディスプレイ'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('lump_sum_3yr');
    expect(result.asset_tier_label).toContain('一括償却');
    expect(result.asset_warning).toContain('一括償却');
    expect(result.warnings.length).toBe(1);
  });

  it('150,000 yen → lump_sum_3yr tier', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(150000, 'PC周辺機器'),
      classified({ category_id: 'supplies' }),
    );
    expect(result.asset_tier).toBe('lump_sum_3yr');
    expect(result.asset_warning).toContain('150,000');
  });

  it('250,000 yen → sme_immediate tier', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(250000, 'Dell モニター大型'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('sme_immediate');
    expect(result.asset_tier_label).toContain('少額減価償却');
    expect(result.asset_tier_label).toContain('中小企業少額特例');
    expect(result.asset_warning).toContain('300万円上限');
  });

  it('299,999 yen → sme_immediate tier (boundary)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(299999, 'オフィス家具'),
      classified({ category_id: 'supplies' }),
    );
    expect(result.asset_tier).toBe('sme_immediate');
  });

  it('300,000 yen → fixed_asset tier (boundary)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(300000, 'MacBook Air 購入'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('fixed_asset');
    expect(result.asset_tier_label).toContain('固定資産');
    expect(result.asset_category_override).toBe('tools_equipment');
    expect(result.asset_warning).toContain('減価償却');
  });

  it('500,000 yen → fixed_asset tier', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(500000, 'MacBook Pro 購入'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('fixed_asset');
    expect(result.asset_warning).toContain('税理士レビュー');
  });

  it('non-consumables/supplies → no asset tier', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(500000, '弁護士報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    expect(result.asset_tier).toBeUndefined();
  });
});

// ── Withholding tax calculation ────────────────────────────────────

describe('calculateWithholding', () => {
  it('500,000 yen → withholding 51,050 yen (10.21%)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(500000, '税理士報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    expect(result.withholding).toBeDefined();
    expect(result.withholding!.gross_amount).toBe(500000);
    expect(result.withholding!.withholding_amount).toBe(51050);
    expect(result.withholding!.net_amount).toBe(500000 - 51050);
    expect(result.withholding!.rate_description).toContain('10.21');
  });

  it('1,000,000 yen → withholding 102,100 yen (10.21% flat, at boundary)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(1000000, '弁護士報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    expect(result.withholding!.withholding_amount).toBe(102100);
  });

  it('1,500,000 yen → withholding 204,200 yen (split bracket)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(1500000, '社労士報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    // First 1M at 10.21% = 102,100
    // Excess 500K at 20.42% = 102,100
    // Total = 204,200
    expect(result.withholding!.withholding_amount).toBe(204200);
    expect(result.withholding!.gross_amount).toBe(1500000);
    expect(result.withholding!.net_amount).toBe(1500000 - 204200);
    expect(result.withholding!.rate_description).toContain('20.42');
  });

  it('2,000,000 yen → withholding at split bracket', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(2000000, 'コンサルティング報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    // First 1M at 10.21% = 102,100
    // Excess 1M at 20.42% = 204,200
    // Total = 306,300
    expect(result.withholding!.withholding_amount).toBe(306300);
  });

  it('100,000 yen → withholding 10,210 yen', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(100000, 'デザイン報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    expect(result.withholding!.withholding_amount).toBe(10210);
  });

  it('non-professional_fee → no withholding', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(500000, 'AWS利用料'),
      classified({ category_id: 'communications' }),
    );
    expect(result.withholding).toBeUndefined();
  });
});

// ── Consumption tax rate refinement ────────────────────────────────

describe('resolveConsumptionTaxRate', () => {
  it('newspaper subscription → 8% (軽減税率)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(4000, '日経新聞 定期購読'),
      classified({ category_id: 'books_magazines' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
    expect(result.consumption_tax_reason).toContain('軽減税率');
  });

  it('朝日新聞 → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(3500, '朝日新聞 月額'),
      classified({ category_id: 'books_magazines' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
  });

  it('regular book → no consumption tax override', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(2000, 'Amazon 技術書籍'),
      classified({ category_id: 'books_magazines' }),
    );
    expect(result.consumption_tax_rate).toBeUndefined();
  });

  it('meeting meal (dine-in default) → 10%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, 'レストラン 商談ランチ'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(10);
    expect(result.consumption_tax_reason).toContain('店内飲食');
  });

  it('takeout meal → 8% (テイクアウト)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(1500, 'テイクアウト 弁当'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
    expect(result.consumption_tax_reason).toContain('テイクアウト');
  });

  it('Uber Eats delivery → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(2000, 'Uber Eats デリバリー'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
  });

  it('出前館 delivery → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(1800, '出前館 注文'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
  });

  it('convenience store food purchase → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(800, 'セブンイレブン おにぎり'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
    expect(result.consumption_tax_reason).toContain('食品購入');
  });

  it('supermarket food purchase → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(3000, 'イオン 食品 会議用'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
  });

  it('catering with service → 10% (not reduced)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(30000, 'ケータリング 配膳サービス付き'),
      classified({ category_id: 'meeting_meal' }),
    );
    expect(result.consumption_tax_rate).toBe(10);
    expect(result.consumption_tax_reason).toContain('配膳サービス');
  });

  it('entertainment takeout → 8%', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(15000, 'テイクアウト 接待用'),
      classified({ category_id: 'entertainment' }),
    );
    expect(result.consumption_tax_rate).toBe(8);
  });

  it('residential rent → 0% (非課税)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(80000, '社宅 家賃'),
      classified({ category_id: 'rent' }),
    );
    expect(result.consumption_tax_rate).toBe(0);
    expect(result.tax_code_override).toBe(0);
    expect(result.consumption_tax_reason).toContain('非課税');
  });

  it('office rent → no override (standard 10%)', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(200000, 'オフィス 賃料'),
      classified({ category_id: 'rent' }),
    );
    expect(result.consumption_tax_rate).toBeUndefined();
    expect(result.tax_code_override).toBeUndefined();
  });
});

// ── Invoice system checker (Tier 3) ──────────────────────────────

describe('checkInvoice', () => {
  it('valid T+13 digits → valid_format true', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('T1234567890123', '2026-05-01');
    expect(result.valid_format).toBe(true);
    expect(result.registration_number).toBe('T1234567890123');
    expect(result.deduction_rate).toBe(100); // registered = full deduction
  });

  it('invalid format (missing T) → valid_format false', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('1234567890123', '2026-05-01');
    expect(result.valid_format).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('形式が不正'))).toBe(true);
  });

  it('invalid format (wrong digit count) → valid_format false', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('T12345678', '2026-05-01');
    expect(result.valid_format).toBe(false);
  });

  it('invalid format (letters after T) → valid_format false', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('T123456789ABCD', '2026-05-01');
    expect(result.valid_format).toBe(false);
  });

  it('undefined registration → valid_format false with warning', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2026-05-01');
    expect(result.valid_format).toBe(false);
    expect(result.warnings.some(w => w.includes('登録番号が確認できません'))).toBe(true);
  });

  it('empty string registration → valid_format false', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('', '2026-05-01');
    expect(result.valid_format).toBe(false);
  });
});

describe('getTransitionalPeriod', () => {
  it('2024-06-01 → 80% deduction (first period)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2024-06-01');
    expect(period.deduction_rate).toBe(80);
    expect(period.label).toContain('80%');
  });

  it('2026-05-01 → 80% deduction (still in first period)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2026-05-01');
    expect(period.deduction_rate).toBe(80);
  });

  it('2026-09-30 → 80% (last day of first period)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2026-09-30');
    expect(period.deduction_rate).toBe(80);
  });

  it('2026-10-01 → 50% deduction (second period starts)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2026-10-01');
    expect(period.deduction_rate).toBe(50);
    expect(period.label).toContain('50%');
  });

  it('2028-03-15 → 50% deduction (mid second period)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2028-03-15');
    expect(period.deduction_rate).toBe(50);
  });

  it('2029-10-01 → 0% deduction (transitional ends)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2029-10-01');
    expect(period.deduction_rate).toBe(0);
    expect(period.label).toContain('控除不可');
  });

  it('2023-09-30 → 100% deduction (pre-invoice system)', () => {
    const engine = makeEngine();
    const period = engine.getTransitionalPeriod('2023-09-30');
    expect(period.deduction_rate).toBe(100);
    expect(period.label).toContain('施行前');
  });
});

describe('checkInvoice with tax amounts', () => {
  it('registered vendor → full deduction', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice('T1234567890123', '2026-05-01', 10000);
    expect(result.deductible_amount).toBe(10000);
    expect(result.non_deductible_amount).toBe(0);
  });

  it('unregistered vendor in period 1 → 80% deduction', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2026-05-01', 10000);
    expect(result.deduction_rate).toBe(80);
    expect(result.deductible_amount).toBe(8000);
    expect(result.non_deductible_amount).toBe(2000);
    expect(result.warnings.some(w => w.includes('80%'))).toBe(true);
  });

  it('unregistered vendor in period 2 → 50% deduction', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2027-01-15', 20000);
    expect(result.deduction_rate).toBe(50);
    expect(result.deductible_amount).toBe(10000);
    expect(result.non_deductible_amount).toBe(10000);
  });

  it('unregistered vendor after 2029-10 → 0% deduction', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2030-01-01', 15000);
    expect(result.deduction_rate).toBe(0);
    expect(result.deductible_amount).toBe(0);
    expect(result.non_deductible_amount).toBe(15000);
  });

  it('small amount (< 10,000) → small business exception', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2026-05-01', 5000);
    expect(result.small_business_exception).toBe(true);
    expect(result.deductible_amount).toBe(5000);
    expect(result.non_deductible_amount).toBe(0);
  });

  it('exactly 10,000 → NOT small business exception', () => {
    const engine = makeEngine();
    const result = engine.checkInvoice(undefined, '2026-05-01', 10000);
    expect(result.small_business_exception).toBe(false);
  });
});

describe('validateRegistrationNumber', () => {
  it('T1234567890123 → true', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('T1234567890123')).toBe(true);
  });

  it('T0000000000000 → true (all zeros valid)', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('T0000000000000')).toBe(true);
  });

  it('T9999999999999 → true', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('T9999999999999')).toBe(true);
  });

  it('T123456789012 → false (12 digits)', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('T123456789012')).toBe(false);
  });

  it('T12345678901234 → false (14 digits)', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('T12345678901234')).toBe(false);
  });

  it('1234567890123 → false (no T prefix)', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('1234567890123')).toBe(false);
  });

  it('undefined → false', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber(undefined)).toBe(false);
  });

  it('empty string → false', () => {
    const engine = makeEngine();
    expect(engine.validateRegistrationNumber('')).toBe(false);
  });
});

// ── Edge cases & integration ───────────────────────────────────────

describe('edge cases', () => {
  it('unclassified transaction → empty result', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(5000, '不明な取引'),
      {
        classified: false,
        confidence: 'none',
        match_reason: 'No match',
        classifier_version: '1.0.0',
      },
    );
    expect(result.tax_code_override).toBeUndefined();
    expect(result.withholding).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.rule_config_version).toBe('1.1.0');
  });

  it('overseas SaaS in memo but keyword different → still detected via memo scan', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(3000, 'Stripe 決済手数料'),
      classified({ category_id: 'communications', matched_keyword: 'クレジット' }),
    );
    expect(result.tax_code_override).toBe(0);
  });

  it('negative amount (refund) is treated by absolute value for asset tier', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(-150000, '返品 モニター'),
      classified({ category_id: 'consumables' }),
    );
    expect(result.asset_tier).toBe('lump_sum_3yr');
  });

  it('withholding + professional_fee combined correctly', () => {
    const engine = makeEngine();
    const result = engine.applyRules(
      tx(800000, '弁護士報酬'),
      classified({ category_id: 'professional_fee' }),
    );
    expect(result.withholding).toBeDefined();
    expect(result.withholding!.withholding_amount).toBe(81680);
    // 800000 * 0.1021 = 81,680
    expect(result.withholding!.net_amount).toBe(800000 - 81680);
  });

  it('getVersion returns config version', () => {
    const engine = makeEngine();
    expect(engine.getVersion()).toBe('1.1.0');
  });

  it('throws when config file is missing', () => {
    expect(() => new TaxRuleEngine('/nonexistent/path.json')).toThrow(
      /Tax rule config not found/,
    );
  });

  it('catering with service takes priority over takeout keywords', () => {
    const engine = makeEngine();
    // Memo contains both catering-service AND takeout keywords
    const result = engine.applyRules(
      tx(50000, 'ケータリング 出前 配膳'),
      classified({ category_id: 'meeting_meal' }),
    );
    // Catering with service should win → 10%
    expect(result.consumption_tax_rate).toBe(10);
    expect(result.consumption_tax_reason).toContain('配膳サービス');
  });
});
