// Post-classification tax rule engine.
//
// Runs AFTER keyword classifier (Stage 1) or Claude classifier (Stage 2)
// has assigned a category.  Applies Japanese tax law rules to refine the
// classification — tax codes, amount-based reclassification, withholding
// tax calculations, consumption-tax rate selection, and invoice system checks.
//
// The engine AUGMENTS the ClassificationResult; it never replaces it.
// Downstream code merges TaxRuleResult fields back into the pipeline output.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction, ClassificationResult } from '../classifier/types.js';
import { normalizeMemo } from '../classifier/normalize.js';
import type {
  TaxRuleConfig,
  TaxRuleResult,
  WithholdingResult,
  InvoiceCheckResult,
  AssetCapitalizationTier,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ────────────────────────────────────────────────────────

function defaultDataDir(): string {
  const envDir = process.env.COCKPIT_DATA_DIR;
  if (envDir) return envDir;
  return path.resolve(__dirname, '../../../../data');
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

// ── Engine ─────────────────────────────────────────────────────────

export class TaxRuleEngine {
  private config: TaxRuleConfig;
  private normalizedOverseas: string[];
  private normalizedDomestic: string[];
  private normalizedJctIndicators: string[];
  private normalizedNewspaper: string[];
  private normalizedFoodBev: string[];
  private normalizedResidential: string[];
  private normalizedOverseasAds: string[];
  private normalizedDomesticAds: string[];
  private normalizedTakeout: string[];
  private normalizedFoodPurchase: string[];
  private normalizedCateringService: string[];

  constructor(configFile?: string, dataDir?: string) {
    const dir = dataDir || defaultDataDir();
    const file =
      configFile || path.join(dir, 'tax-rules', 'jp-tax-rules-v1.json');

    if (!fs.existsSync(file)) {
      throw new Error(
        `Tax rule config not found at ${file}. ` +
          `Set COCKPIT_DATA_DIR env var or place data files at the expected path.`,
      );
    }
    const raw = fs.readFileSync(file, 'utf8');
    this.config = JSON.parse(raw) as TaxRuleConfig;

    // Pre-normalize all lookup lists once at construction time
    this.normalizedOverseas = this.config.overseas_saas_providers.map(normalizeMemo);
    this.normalizedDomestic = this.config.domestic_telecom_providers.map(normalizeMemo);
    this.normalizedJctIndicators = this.config.jct_indicator_keywords.map(normalizeMemo);
    this.normalizedNewspaper = this.config.consumption_tax.newspaper_keywords.map(normalizeMemo);
    this.normalizedFoodBev = this.config.consumption_tax.food_beverage_keywords.map(normalizeMemo);
    this.normalizedResidential = this.config.consumption_tax.residential_rent_keywords.map(normalizeMemo);

    // Tier 2: New normalized lists
    this.normalizedOverseasAds = (this.config.overseas_ad_platforms || []).map(normalizeMemo);
    this.normalizedDomesticAds = (this.config.domestic_ad_platforms || []).map(normalizeMemo);
    this.normalizedTakeout = (this.config.consumption_tax.takeout_delivery_keywords || []).map(normalizeMemo);
    this.normalizedFoodPurchase = (this.config.consumption_tax.food_purchase_keywords || []).map(normalizeMemo);
    this.normalizedCateringService = (this.config.consumption_tax.catering_with_service_keywords || []).map(normalizeMemo);
  }

  // ── Main entry point ──────────────────────────────────────────

  /**
   * Apply all post-classification rules to a transaction.
   * Returns a TaxRuleResult describing any adjustments to make.
   */
  applyRules(tx: Transaction, classification: ClassificationResult): TaxRuleResult {
    const result: TaxRuleResult = {
      warnings: [],
      rule_config_version: this.config.version,
    };

    if (!classification.classified) {
      return result; // nothing to refine
    }

    // 1. Non-taxable category check (Tier 2: bulk handling for simple categories)
    if (this.resolveNonTaxableCategory(classification, result)) {
      return result; // early return — no further rules needed
    }

    // 2. Overseas SaaS tax-code correction
    this.resolveOverseasSaasTaxCode(tx, classification, result);

    // 3. Overseas advertising tax-code correction (Tier 2)
    this.resolveOverseasAdTaxCode(tx, classification, result);

    // 4. Asset capitalisation tier routing
    this.resolveAssetCapitalization(tx, classification, result);

    // 5. Withholding tax calculation
    this.calculateWithholding(tx, classification, result);

    // 6. Consumption tax rate refinement (only if not already overridden)
    if (result.tax_code_override === undefined) {
      this.resolveConsumptionTaxRate(tx, classification, result);
    }

    return result;
  }

  // ── (a) Non-taxable category bulk handler (Tier 2) ────────────

  /**
   * If the category is in the non_taxable_categories list, immediately set
   * tax_code to 0 with the configured reason. Returns true if handled.
   */
  private resolveNonTaxableCategory(
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): boolean {
    const catId = classification.category_id ?? '';
    const nonTaxable = this.config.consumption_tax.non_taxable_categories || [];

    if (!nonTaxable.includes(catId)) return false;

    const reasons = this.config.consumption_tax.non_taxable_reasons || {};
    const reason = reasons[catId] || `${catId} — 消費税対象外`;

    out.tax_code_override = 0;
    out.tax_code_reason = `${reason}のため税コード0に変更`;
    out.consumption_tax_rate = 0;
    out.consumption_tax_reason = reason;

    return true;
  }

  // ── (b) Overseas SaaS tax-code override ───────────────────────

  /**
   * If category is "communications" and the keyword/memo matches a known
   * overseas SaaS provider, override tax_code to 0 (対象外).
   *
   * Exception: if the memo contains a JCT indicator (= the overseas provider
   * is charging Japanese consumption tax via an invoice), keep tax_code 2.
   */
  resolveOverseasSaasTaxCode(
    tx: Transaction,
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): void {
    if (classification.category_id !== 'communications') return;

    const normalizedMemo = normalizeMemo(tx.memo);
    const normalizedKeyword = classification.matched_keyword
      ? normalizeMemo(classification.matched_keyword)
      : '';

    // Check domestic providers first — if domestic, no override needed
    if (this.matchesProvider(normalizedMemo, normalizedKeyword, this.normalizedDomestic)) {
      return; // domestic telecom -> keep default tax_code (2 = 10%)
    }

    // Check overseas providers
    if (!this.matchesProvider(normalizedMemo, normalizedKeyword, this.normalizedOverseas)) {
      return; // not a recognised overseas provider
    }

    // JCT exception: if memo indicates the provider IS charging JP consumption tax
    if (containsAny(normalizedMemo, this.normalizedJctIndicators)) {
      out.warnings.push(
        '海外SaaSだがJCT/消費税/インボイス表記あり — 税コード2(10%)を維持します。適格請求書の確認を推奨。',
      );
      return;
    }

    // Override to tax_code 0 (対象外)
    out.tax_code_override = 0;
    out.tax_code_reason =
      '海外SaaSプロバイダー — 国外取引のため消費税対象外(税コード0)に変更。';
    out.consumption_tax_rate = 0;
    out.consumption_tax_reason = '国外取引 — 消費税対象外';
  }

  // ── (b2) Overseas advertising tax-code override (Tier 2) ──────

  /**
   * If category is "advertising" and the keyword/memo matches a known
   * overseas ad platform, override tax_code to 0 (対象外).
   *
   * Google Ads, Meta Ads etc. are invoiced from overseas entities.
   * Same JCT exception as overseas SaaS.
   */
  resolveOverseasAdTaxCode(
    tx: Transaction,
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): void {
    if (classification.category_id !== 'advertising') return;
    if (out.tax_code_override !== undefined) return; // already handled

    const normalizedMemo = normalizeMemo(tx.memo);
    const normalizedKeyword = classification.matched_keyword
      ? normalizeMemo(classification.matched_keyword)
      : '';

    // Check domestic ad platforms first
    if (this.matchesProvider(normalizedMemo, normalizedKeyword, this.normalizedDomesticAds)) {
      return; // domestic ad platform -> keep default tax_code (2 = 10%)
    }

    // Check overseas ad platforms
    if (!this.matchesProvider(normalizedMemo, normalizedKeyword, this.normalizedOverseasAds)) {
      return;
    }

    // JCT exception
    if (containsAny(normalizedMemo, this.normalizedJctIndicators)) {
      out.warnings.push(
        '海外広告プラットフォームだがJCT/消費税/インボイス表記あり — 税コード2(10%)を維持。',
      );
      return;
    }

    out.tax_code_override = 0;
    out.tax_code_reason =
      '海外広告プラットフォーム — 国外取引のため消費税対象外(税コード0)に変更。';
    out.consumption_tax_rate = 0;
    out.consumption_tax_reason = '国外取引(海外広告) — 消費税対象外';
  }

  // ── (c) Asset capitalisation tier routing ─────────────────────

  /**
   * If category is "consumables" or "supplies" and the amount is significant,
   * determine the correct asset capitalisation tier and add warnings.
   */
  resolveAssetCapitalization(
    tx: Transaction,
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): void {
    const catId = classification.category_id ?? '';
    if (catId !== 'consumables' && catId !== 'supplies') return;

    const amount = Math.abs(tx.amount);
    const thresholds = this.config.asset_capitalization;

    if (amount <= thresholds.expense_max) {
      // Tier: expense — OK as-is
      out.asset_tier = 'expense';
      out.asset_tier_label = '少額経費 (損金算入OK)';
      return;
    }

    if (amount <= thresholds.lump_sum_3yr_max) {
      // Tier: 一括償却資産 (3-year straight-line)
      out.asset_tier = 'lump_sum_3yr';
      out.asset_tier_label = '一括償却資産 (3年均等償却)';
      out.asset_warning =
        `金額${amount.toLocaleString()}円: 一括償却資産(3年均等)の可能性あり。税理士確認を推奨。`;
      out.warnings.push(out.asset_warning);
      return;
    }

    if (amount <= thresholds.sme_immediate_max) {
      // Tier: 少額減価償却資産 (SME immediate expense)
      out.asset_tier = 'sme_immediate';
      out.asset_tier_label = '少額減価償却資産 (中小企業少額特例・即時損金)';
      out.asset_warning =
        `金額${amount.toLocaleString()}円: 中小企業少額特例(即時損金算入)の適用可能性あり。` +
        `年間合計300万円上限に注意。税理士確認を推奨。`;
      out.warnings.push(out.asset_warning);
      return;
    }

    // Tier: 固定資産 — must be reclassified
    out.asset_tier = 'fixed_asset';
    out.asset_tier_label = '固定資産 (減価償却必要)';
    out.asset_category_override = 'tools_equipment'; // 工具器具備品
    out.asset_warning =
      `金額${amount.toLocaleString()}円: 固定資産として計上が必要です(工具器具備品等)。` +
      `減価償却が必要 — 必ず税理士レビューを実施してください。`;
    out.warnings.push(out.asset_warning);
  }

  // ── (d) Withholding tax calculation ───────────────────────────

  /**
   * For professional_fee category, calculate informational withholding tax
   * (源泉徴収税額) to help tax accountants verify freee entries.
   */
  calculateWithholding(
    tx: Transaction,
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): void {
    if (classification.category_id !== 'professional_fee') return;

    const gross = Math.abs(tx.amount);
    const { bracket_1_ceiling, rate_bracket_1, rate_bracket_2 } =
      this.config.withholding_tax;

    let withholdingAmount: number;
    let rateDesc: string;

    if (gross <= bracket_1_ceiling) {
      withholdingAmount = Math.floor(gross * rate_bracket_1);
      rateDesc = `${(rate_bracket_1 * 100).toFixed(2)}% (${bracket_1_ceiling.toLocaleString()}円以下)`;
    } else {
      const part1 = Math.floor(bracket_1_ceiling * rate_bracket_1);
      const part2 = Math.floor((gross - bracket_1_ceiling) * rate_bracket_2);
      withholdingAmount = part1 + part2;
      rateDesc =
        `${bracket_1_ceiling.toLocaleString()}円まで${(rate_bracket_1 * 100).toFixed(2)}% + ` +
        `超過分${(rate_bracket_2 * 100).toFixed(2)}%`;
    }

    const withholding: WithholdingResult = {
      gross_amount: gross,
      withholding_amount: withholdingAmount,
      net_amount: gross - withholdingAmount,
      rate_description: rateDesc,
    };

    out.withholding = withholding;
    out.warnings.push(
      `源泉徴収税額(税理士参考情報): ${withholdingAmount.toLocaleString()}円 — freee登録値と照合を推奨。`,
    );
  }

  // ── (e) Consumption tax rate refinement ───────────────────────

  /**
   * Determine the correct consumption tax rate based on category and keywords.
   *
   * Decision tree (Tier 2 expanded):
   * - overseas SaaS/ads -> 0% (handled earlier)
   * - non-taxable categories -> 0% (handled by resolveNonTaxableCategory)
   * - books_magazines + newspaper keyword -> 8% (軽減税率)
   * - meeting_meal + takeout/delivery -> 8%
   * - meeting_meal + food purchase (convenience store) -> 8%
   * - meeting_meal + catering with service -> 10%
   * - meeting_meal (default dine-in) -> 10%
   * - rent + residential keyword -> 0% (非課税)
   */
  resolveConsumptionTaxRate(
    tx: Transaction,
    classification: ClassificationResult,
    out: TaxRuleResult,
  ): void {
    const catId = classification.category_id ?? '';
    const normalizedMemo = normalizeMemo(tx.memo);

    // Newspaper subscription -> reduced rate 8%
    if (catId === 'books_magazines') {
      if (containsAny(normalizedMemo, this.normalizedNewspaper)) {
        out.consumption_tax_rate = this.config.consumption_tax.reduced_rate;
        out.consumption_tax_reason = '定期購読の新聞 — 軽減税率8%適用';
        return;
      }
    }

    // Meeting meals -> complex reduced-rate logic
    if (catId === 'meeting_meal') {
      this.resolveMeetingMealTaxRate(normalizedMemo, out);
      return;
    }

    // Entertainment (交際費) -> also check food/takeout
    if (catId === 'entertainment') {
      // Takeout/delivery for entertainment is still 8%
      if (containsAny(normalizedMemo, this.normalizedTakeout)) {
        out.consumption_tax_rate = this.config.consumption_tax.reduced_rate;
        out.consumption_tax_reason = 'テイクアウト/デリバリー(交際費) — 軽減税率8%適用の可能性あり';
        out.warnings.push('交際費のテイクアウト判定: 軽減税率8%を適用。店内飲食の場合は10%に要修正。');
        return;
      }
    }

    // Residential rent -> exempt 0%
    if (catId === 'rent') {
      if (containsAny(normalizedMemo, this.normalizedResidential)) {
        out.consumption_tax_rate = this.config.consumption_tax.exempt_rate;
        out.consumption_tax_reason = '住居用賃料 — 消費税非課税';
        out.tax_code_override = 0;
        out.tax_code_reason = '住居用賃料 — 消費税非課税のため税コード0に変更';
        return;
      }
    }
  }

  /**
   * Detailed meeting_meal consumption tax resolution (Tier 2).
   *
   * Priority order:
   * 1. Catering with service (配膳あり) -> 10% standard
   * 2. Takeout / delivery -> 8% reduced
   * 3. Food purchase (convenience store, supermarket) -> 8% reduced
   * 4. Default dine-in -> 10% standard
   */
  private resolveMeetingMealTaxRate(normalizedMemo: string, out: TaxRuleResult): void {
    // 1. Catering with serving staff -> standard rate
    if (containsAny(normalizedMemo, this.normalizedCateringService)) {
      out.consumption_tax_rate = this.config.consumption_tax.standard_rate;
      out.consumption_tax_reason = 'ケータリング(配膳サービス付き) — 標準税率10%適用(飲食サービスに該当)';
      return;
    }

    // 2. Takeout / delivery -> reduced rate
    if (containsAny(normalizedMemo, this.normalizedTakeout)) {
      out.consumption_tax_rate = this.config.consumption_tax.reduced_rate;
      out.consumption_tax_reason = 'テイクアウト/デリバリー — 軽減税率8%適用';
      out.warnings.push('テイクアウト判定: 軽減税率8%を適用。店内飲食の場合は10%に要修正。');
      return;
    }

    // 3. Food purchase from convenience store / supermarket -> reduced rate
    if (containsAny(normalizedMemo, this.normalizedFoodPurchase)) {
      out.consumption_tax_rate = this.config.consumption_tax.reduced_rate;
      out.consumption_tax_reason = '食品購入(持ち帰り前提) — 軽減税率8%適用';
      out.warnings.push('コンビニ/スーパー等の食品購入: 軽減税率8%を適用。イートイン利用の場合は10%に要修正。');
      return;
    }

    // 4. Default: dine-in -> standard rate
    out.consumption_tax_rate = this.config.consumption_tax.standard_rate;
    out.consumption_tax_reason = '会議費(飲食) — 標準税率10%(店内飲食前提)';
  }

  // ── (f) Invoice system checker (Tier 3) ───────────────────────

  /**
   * Validate an invoice registration number and calculate the transitional
   * period deduction rate.
   *
   * @param registrationNumber  T + 13 digits (e.g. "T1234567890123")
   * @param txDate              Transaction date (YYYY-MM-DD) for period lookup
   * @param taxAmount           Consumption tax amount for deduction calculation
   */
  checkInvoice(
    registrationNumber: string | undefined,
    txDate: string,
    taxAmount?: number,
  ): InvoiceCheckResult {
    const warnings: string[] = [];

    // Format validation
    const validFormat = this.validateRegistrationNumber(registrationNumber);

    // Period lookup
    const { deduction_rate, label } = this.getTransitionalPeriod(txDate);

    // Small business exception
    const smallBizThreshold = this.config.invoice_system.small_business_threshold;
    const smallBusinessException = (taxAmount !== undefined && taxAmount < smallBizThreshold);

    // Calculate deductible amounts
    let deductibleAmount: number | undefined;
    let nonDeductibleAmount: number | undefined;

    if (taxAmount !== undefined) {
      if (validFormat) {
        // Registered vendor -> full deduction
        deductibleAmount = taxAmount;
        nonDeductibleAmount = 0;
      } else if (smallBusinessException) {
        // Small business exception -> full deduction from ledger alone
        deductibleAmount = taxAmount;
        nonDeductibleAmount = 0;
        warnings.push(
          `${this.config.invoice_system.small_business_note}`,
        );
      } else {
        // Non-registered vendor -> transitional deduction
        deductibleAmount = Math.floor(taxAmount * (deduction_rate / 100));
        nonDeductibleAmount = taxAmount - deductibleAmount;

        if (deduction_rate < 100) {
          warnings.push(
            `適格請求書番号なし — ${label}。` +
            `仕入税額控除: ${deductibleAmount.toLocaleString()}円(${deduction_rate}%)、` +
            `控除不可額: ${nonDeductibleAmount.toLocaleString()}円。`,
          );
        }
      }
    }

    if (!registrationNumber) {
      if (!smallBusinessException) {
        warnings.push(
          '適格請求書発行事業者の登録番号が確認できません。仕入税額控除の可否を確認してください。',
        );
      }
    } else if (!validFormat) {
      warnings.push(
        `登録番号「${registrationNumber}」の形式が不正です。正しい形式: T + 数字13桁 (例: T1234567890123)。`,
      );
    }

    return {
      valid_format: validFormat,
      registration_number: registrationNumber,
      deduction_rate: validFormat ? 100 : deduction_rate,
      period_label: label,
      deductible_amount: deductibleAmount,
      non_deductible_amount: nonDeductibleAmount,
      small_business_exception: smallBusinessException,
      warnings,
    };
  }

  /**
   * Validate T + 13 digits format.
   */
  validateRegistrationNumber(num: string | undefined): boolean {
    if (!num) return false;
    const prefix = this.config.invoice_system.registration_prefix;
    const digits = this.config.invoice_system.registration_digits;
    const pattern = new RegExp(`^${prefix}\\d{${digits}}$`);
    return pattern.test(num);
  }

  /**
   * Get the transitional period deduction rate for a given date.
   */
  getTransitionalPeriod(txDate: string): { deduction_rate: number; label: string } {
    const periods = this.config.invoice_system.transitional_periods;

    for (const period of periods) {
      if (txDate >= period.start && txDate <= period.end) {
        return { deduction_rate: period.deduction_rate, label: period.label };
      }
    }

    // Before invoice system (pre-2023-10-01) -> full deduction
    return { deduction_rate: 100, label: 'インボイス制度施行前 — 仕入税額控除100%' };
  }

  // ── Utilities ─────────────────────────────────────────────────

  /**
   * Check if the memo or matched keyword matches any provider in the list.
   */
  private matchesProvider(
    normalizedMemo: string,
    normalizedKeyword: string,
    providerList: string[],
  ): boolean {
    // Check the matched keyword first (most specific)
    if (normalizedKeyword && providerList.includes(normalizedKeyword)) {
      return true;
    }
    // Fall back to substring match in memo
    return containsAny(normalizedMemo, providerList);
  }

  getVersion(): string {
    return this.config.version;
  }
}
