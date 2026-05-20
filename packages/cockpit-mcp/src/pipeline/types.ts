// Pipeline result types for the nightly batch processor.
//
// These types represent the full lifecycle of a transaction through the pipeline:
//   Stage 0 (exclusion) → Stage 1 (keyword) → Stage 2 (Claude) → Confidence routing → Action
//
// Routing decisions follow the CLAUDE.md business manual:
//   high confidence + no flags  → auto_register
//   medium confidence           → auto_register_with_log (= 自動仕訳 + 確認待ちmirror)
//   low confidence              → human_review only
//   100万円超 / 新規取引先 / 月次決算期間 → human_review regardless

// ============================================================
// Routing
// ============================================================

export type RoutingAction =
  | 'auto_register'          // freee に自動仕訳
  | 'auto_register_with_log' // 自動仕訳 + 確認待ちqueue にも mirror
  | 'human_review';          // 確認待ちqueueのみ (= 自動仕訳しない)

export type RoutingFlag =
  | 'high_amount'            // > 1,000,000 JPY
  | 'new_partner'            // 取引先マスタ未登録
  | 'low_confidence'         // Stage 2 low confidence
  | 'medium_confidence'      // Stage 2 medium confidence
  | 'excluded'               // Stage 0 exclusion rule 該当
  | 'unclassified'           // 分類不能
  | 'monthly_close_period';  // 月初 1-5日 = 月次決算期間

export interface RoutingDecision {
  action: RoutingAction;
  reasons: string[];
  flags: RoutingFlag[];
}

// ============================================================
// Processed Transaction (= pipeline output per deal)
// ============================================================

export interface ProcessedTransaction {
  deal_id: number;
  company_id: number;
  issue_date: string;
  amount: number;
  memo: string;
  partner_name?: string;

  // Pipeline stage results
  excluded: boolean;
  exclusion_rule?: string;
  exclusion_reason?: string;
  classified: boolean;
  stage?: 1 | 2;                // undefined if unclassified
  category_id?: string;
  category_name_ja?: string;
  confidence?: 'high' | 'medium' | 'low' | 'none';
  matched_keyword?: string;

  // Memory integration (Linksee Memory pattern/correction match)
  memory_source?: 'pattern' | 'correction';
  memory_pattern_key?: string;
  memory_match_count?: number;

  // Final routing decision
  routing: RoutingDecision;
}

// ============================================================
// Per-company batch result
// ============================================================

export interface CompanyBatchResult {
  company_id: number;
  company_name: string;
  total_deals: number;
  processing_time_ms: number;
  ok: boolean;
  error?: string;

  summary: {
    auto_registered: number;
    auto_registered_with_log: number;
    human_review: number;
    excluded: number;
    classified_stage1: number;
    classified_stage2: number;
    unclassified: number;
    errors: number;
  };

  confidence_breakdown: {
    high: number;
    medium: number;
    low: number;
    none: number;
  };

  // Items that need human attention (= 確認待ちqueue)
  review_queue: ProcessedTransaction[];

  // First N items for summary display
  sample: ProcessedTransaction[];
}

// ============================================================
// Overall nightly run result
// ============================================================

export interface NightlyRunResult {
  ok: boolean;
  dry_run: boolean;
  started_at: string;
  finished_at: string;
  total_companies: number;
  total_deals: number;

  aggregate: {
    auto_registered: number;
    auto_registered_with_log: number;
    human_review: number;
    excluded: number;
    classified_stage1: number;
    classified_stage2: number;
    unclassified: number;
    errors: number;
  };

  companies: CompanyBatchResult[];

  classifier: {
    stage1_version: string;
    stage1_keywords: number;
    stage1_categories: number;
    stage2_enabled: boolean;
    stage2_model: string | null;
  };

  exclusion_version: string;

  // Slack-ready summary text
  slack_summary: string;

  note: string;
}
