// Types for the post-classification tax rule engine.
//
// These types augment — never replace — the ClassificationResult from
// src/classifier/types.ts.  The engine returns adjustments that the pipeline
// layer merges back into the final result.

// ── Withholding tax ────────────────────────────────────────────────

export interface WithholdingResult {
  /** Gross payment (same as tx.amount) */
  gross_amount: number;
  /** Calculated withholding tax amount */
  withholding_amount: number;
  /** Net payment after withholding */
  net_amount: number;
  /** Human-readable rate description, e.g. "10.21% flat" */
  rate_description: string;
}

// ── Asset capitalisation tiers ─────────────────────────────────────

export type AssetCapitalizationTier =
  | 'expense'           // < 100,000 yen — consumables / supplies OK
  | 'lump_sum_3yr'      // 100,000 - 199,999 yen — 一括償却資産 (3-year straight-line)
  | 'sme_immediate'     // 200,000 - 299,999 yen (SME only) — 少額減価償却資産 (immediate expense)
  | 'fixed_asset';      // >= 300,000 yen — 固定資産 (full depreciation required)

// ── Engine output ──────────────────────────────────────────────────

export interface TaxRuleResult {
  /** If set, the engine recommends a different tax_code than the classifier assigned. */
  tax_code_override?: number;
  /** Why the override was applied (human-readable, Japanese). */
  tax_code_reason?: string;

  /** Consumption-tax rate override (0, 8, or 10). */
  consumption_tax_rate?: number;
  /** Reason for consumption-tax override. */
  consumption_tax_reason?: string;

  /** Asset capitalisation tier (only set when relevant). */
  asset_tier?: AssetCapitalizationTier;
  /** Human-readable asset-tier label in Japanese. */
  asset_tier_label?: string;
  /** Warning string for asset-tier reclassification. */
  asset_warning?: string;
  /** Suggested override category_id for fixed-asset reclassification. */
  asset_category_override?: string;

  /** Withholding-tax calculation (only for professional_fee). */
  withholding?: WithholdingResult;

  /** Invoice system check result (if registration number found or non-registered vendor). */
  invoice_check?: InvoiceCheckResult;

  /** Aggregated warnings / flags for human review. */
  warnings: string[];

  /** Version of the rule config that produced this result. */
  rule_config_version: string;
}

// ── Rule configuration (loaded from JSON) ──────────────────────────

export interface TaxRuleConfig {
  version: string;
  locale: string;

  overseas_saas_providers: string[];
  domestic_telecom_providers: string[];
  jct_indicator_keywords: string[];

  asset_capitalization: {
    expense_max: number;
    lump_sum_3yr_max: number;
    sme_immediate_max: number;
  };

  withholding_tax: {
    /** First bracket ceiling (yen). */
    bracket_1_ceiling: number;
    /** Rate for amounts up to bracket_1_ceiling. */
    rate_bracket_1: number;
    /** Rate for amount exceeding bracket_1_ceiling. */
    rate_bracket_2: number;
  };

  overseas_ad_platforms: string[];
  domestic_ad_platforms: string[];

  consumption_tax: {
    standard_rate: number;
    reduced_rate: number;
    exempt_rate: number;
    newspaper_keywords: string[];
    food_beverage_keywords: string[];
    takeout_delivery_keywords: string[];
    food_purchase_keywords: string[];
    catering_with_service_keywords: string[];
    residential_rent_keywords: string[];
    non_taxable_categories: string[];
    non_taxable_reasons: Record<string, string>;
  };

  invoice_system: {
    registration_prefix: string;
    registration_digits: number;
    transitional_periods: {
      start: string;
      end: string;
      deduction_rate: number;
      label: string;
    }[];
    small_business_threshold: number;
    small_business_note: string;
  };
}

// ── Invoice validation result ─────────────────────────────────────

export interface InvoiceCheckResult {
  /** Whether the registration number is valid format (T + 13 digits). */
  valid_format: boolean;
  /** The registration number checked. */
  registration_number?: string;
  /** Current deduction rate based on transitional period. */
  deduction_rate: number;
  /** Label for the current period. */
  period_label: string;
  /** Amount that can be deducted (tax_amount * deduction_rate). */
  deductible_amount?: number;
  /** Non-deductible amount. */
  non_deductible_amount?: number;
  /** Whether small-business exception applies (< 10,000 yen). */
  small_business_exception: boolean;
  /** Warnings for the tax accountant. */
  warnings: string[];
}
