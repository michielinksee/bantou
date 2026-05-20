// CSV adapter types for multi-platform import support.
//
// Supported sources:
//   - yayoi:       弥生会計 仕訳日記帳 CSV export
//   - freee_export: freee 取引CSV export
//   - mf_export:   MoneyForward CSV export (= Phase 1.B stub)
//   - generic:     汎用 CSV (= user specifies column mapping)

import { Transaction } from '../classifier/types.js';

/** Supported CSV source platforms. */
export type CsvSource = 'yayoi' | 'freee_export' | 'mf_export' | 'generic';

/**
 * Column mapping for generic CSV import.
 * User specifies which columns map to Transaction fields.
 */
export interface ColumnMapping {
  date: string;       // Column header for date
  amount: string;     // Column header for amount
  memo: string;       // Column header for memo / description
  partner_name?: string; // Column header for partner name (optional)
  type?: string;      // Column header for income/expense type (optional)
}

/**
 * A single parsed CSV row before conversion to Transaction.
 */
export interface ParsedCsvRow {
  /** Original row index (1-based, excluding header). */
  row_number: number;
  /** Raw column values keyed by header name. */
  raw: Record<string, string>;
  /** Parsed Transaction (null if row was skipped/invalid). */
  transaction: Transaction | null;
  /** Skip reason (null if successfully parsed). */
  skip_reason: string | null;
}

/**
 * Result of CSV import + classification pipeline.
 */
export interface ImportResult {
  ok: boolean;
  source: CsvSource;
  /** Source format detected or specified. */
  source_label: string;

  // Parsing stats
  total_rows: number;
  parsed_count: number;
  skipped_count: number;
  warnings: string[];

  // Classification results (after pipeline)
  auto_register: ClassifiedTransaction[];
  auto_register_with_log: ClassifiedTransaction[];
  human_review: ClassifiedTransaction[];
  excluded: ClassifiedTransaction[];

  // Aggregate
  summary: {
    auto_register_count: number;
    auto_register_with_log_count: number;
    human_review_count: number;
    excluded_count: number;
    classification_rate: string; // e.g. "94.2%"
  };

  // CSV output (for re-import into 弥生 or other tools)
  csv_output?: string;
  // Markdown report
  markdown_report?: string;
}

/**
 * A transaction that has been through the full pipeline
 * (exclusion + classification + routing).
 */
export interface ClassifiedTransaction {
  row_number: number;
  transaction: Transaction;
  // Exclusion
  excluded: boolean;
  exclusion_rule?: string;
  exclusion_reason?: string;
  // Classification
  classified: boolean;
  category_id?: string;
  category_name_ja?: string;
  confidence?: 'high' | 'medium' | 'low' | 'none';
  matched_keyword?: string;
  stage?: number;
  freee_account_code?: number;
  tax_code?: number;
  // Tax Rule Engine (post-classification refinements)
  tax_code_override?: number;
  tax_code_reason?: string;
  asset_tier?: string;
  asset_warning?: string;
  withholding_amount?: number;
  withholding_rate?: string;
  consumption_tax_rate?: number;
  consumption_tax_reason?: string;
  // Invoice system
  invoice_valid?: boolean;
  invoice_deduction_rate?: number;
  invoice_warnings?: string[];
  tax_rule_warnings?: string[];
  // Routing
  action: 'auto_register' | 'auto_register_with_log' | 'human_review';
  routing_flags: string[];
  routing_reasons: string[];
}

/**
 * Interface for platform-specific CSV adapters.
 */
export interface CsvAdapter {
  readonly source: CsvSource;
  readonly label: string;

  /**
   * Detect whether the given CSV headers match this adapter's format.
   * @param headers - Array of column header strings from the first row.
   * @returns true if this adapter can parse the CSV.
   */
  detectFormat(headers: string[]): boolean;

  /**
   * Parse a single CSV row into a Transaction.
   * @param row - Key-value record (header → value).
   * @param rowNumber - 1-based row index.
   * @returns Parsed Transaction, or null with reason if row should be skipped.
   */
  parseRow(row: Record<string, string>, rowNumber: number): { transaction: Transaction | null; skip_reason: string | null };
}
