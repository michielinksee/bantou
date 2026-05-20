// Shared types for keyword classifier + exclusion checker.

export interface Transaction {
  amount: number;
  memo: string;
  date: string; // YYYY-MM-DD
  partner_name?: string;
  company_id?: number;
}

export interface ClassificationResult {
  classified: boolean;
  category_id?: string;
  category_name_ja?: string;
  freee_account_code?: number;
  tax_code?: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  matched_keyword?: string;
  match_reason: string;
  classifier_version: string;
  amount_override_redirect?: string; // if amount threshold redirected
  special_pattern?: string;
}

export interface ExclusionResult {
  excluded: boolean;
  rule_id?: string;
  rule_name_ja?: string;
  reason?: string;
  suggested_next_step?: string;
  action_type?: 'human_review' | 'alternative_workflow' | 'skip_silently';
  alternative_workflow_id?: string;
  matched_keyword?: string;
}
