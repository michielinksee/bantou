// Memory types for Cockpit MCP's Linksee Memory integration.
//
// Inspired by Linksee's 6-layer model:
//   - implementation layer → ClassificationPattern (HOW we classified before)
//   - caveat layer         → CorrectionRecord (PAIN: never repeat this mistake)
//   - context layer        → CompanyMemoryConfig (WHY-THIS-NOW per company)
//
// The memory enables the "判断の境界線" pattern:
//   "過去パターン一致 → AI 処理 OK、新規 → 確認"

import { Transaction } from '../classifier/types.js';

// ============================================================
// Classification Pattern (= Linksee implementation layer)
// ============================================================

/** A learned classification pattern — "we classified this before, here's what we decided." */
export interface ClassificationPattern {
  /** Normalized lookup key (from partner_name or memo keywords) */
  partner_key: string;

  /** Original partner name (for display) */
  partner_name?: string;

  /** First memo that created this pattern (for reference) */
  memo_sample: string;

  /** Extracted keywords from memo (for fuzzy matching when partner is absent) */
  memo_keywords: string[];

  /** Category assigned */
  category_id: string;
  category_name_ja: string;

  /** freee-specific codes (if known) */
  freee_account_code?: number;
  tax_code?: number;

  /** Typical amount for this pattern */
  amount_typical: number;

  /** Where this classification came from originally */
  confidence_source: 'keyword' | 'claude' | 'correction';

  /** How many times this pattern has been matched */
  match_count: number;

  /** Timestamps */
  first_seen: string;
  last_seen: string;

  /** Companies where this pattern was observed */
  company_ids: number[];
}

// ============================================================
// Correction Record (= Linksee caveat layer — never forgotten)
// ============================================================

/** A tax accountant correction — "this was wrong, use this instead." */
export interface CorrectionRecord {
  /** Unique ID */
  id: string;

  /** Normalized partner key (for lookup) */
  partner_key: string;

  /** Memo substring that triggers this correction */
  memo_pattern: string;

  /** What it was classified as (wrong) */
  from_category_id?: string;
  from_category_name_ja?: string;

  /** What it should be (correct) */
  to_category_id: string;
  to_category_name_ja: string;
  to_freee_account_code?: number;
  to_tax_code?: number;

  /** Why the correction was made */
  reason: string;

  /** When the correction was recorded */
  corrected_at: string;

  /** Company-specific (null = applies to all companies) */
  company_id?: number;

  /** Whether this correction is still active */
  active: boolean;
}

// ============================================================
// Company Config (= Linksee context layer)
// ============================================================

/** Per-company routing overrides — "this company needs special treatment." */
export interface CompanyMemoryConfig {
  company_id: number;
  company_name?: string;

  /** Override: transactions above this amount → human_review */
  high_amount_threshold?: number;

  /** Override: minimum confidence for auto_register */
  auto_register_min_confidence?: 'high' | 'medium';

  /** Freeform notes */
  notes?: string;

  updated_at: string;
}

// ============================================================
// Recall result
// ============================================================

/** Result of recalling a past pattern or correction for a transaction. */
export interface PatternRecallResult {
  /** Whether a pattern or correction was found */
  found: boolean;

  /** The matched pattern (if any) */
  pattern?: ClassificationPattern;

  /** The matched correction (if any — takes priority over pattern) */
  correction?: CorrectionRecord;

  /** What was used: 'correction' > 'pattern' > 'none' */
  source: 'pattern' | 'correction' | 'none';

  /** Effective confidence for routing */
  confidence: 'high' | 'medium' | 'low';

  /** Human-readable explanation */
  reason: string;
}

// ============================================================
// Memory Store (= persistence format)
// ============================================================

export interface MemoryStore {
  version: string;
  created_at: string;
  updated_at: string;

  /** Patterns indexed by partner_key. Multiple patterns per key (different amounts/categories). */
  patterns: Record<string, ClassificationPattern[]>;

  /** All corrections (searched sequentially; corrections are rare, linear scan is fine). */
  corrections: CorrectionRecord[];

  /** Company-specific configs indexed by company_id. */
  company_configs: Record<number, CompanyMemoryConfig>;

  /** Aggregate stats for monitoring. */
  stats: MemoryStats;
}

export interface MemoryStats {
  total_patterns: number;
  total_corrections: number;
  pattern_hits: number;
  correction_hits: number;
  cache_misses: number;
  last_save: string;
}

// ============================================================
// Input types for public API
// ============================================================

export interface CorrectionInput {
  memo_pattern: string;
  partner_name?: string;
  from_category_id?: string;
  from_category_name_ja?: string;
  to_category_id: string;
  to_category_name_ja: string;
  to_freee_account_code?: number;
  to_tax_code?: number;
  reason: string;
  company_id?: number;
}
