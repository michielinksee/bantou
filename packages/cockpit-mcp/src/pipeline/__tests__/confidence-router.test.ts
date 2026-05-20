import { describe, it, expect } from 'vitest';
import { ConfidenceRouter } from '../confidence-router.js';
import type { ClassificationResult, ExclusionResult } from '../../classifier/types.js';

const NOT_EXCLUDED: ExclusionResult = { excluded: false };
const EXCLUDED: ExclusionResult = {
  excluded: true,
  rule_id: 'atm_withdrawal',
  rule_name_ja: 'ATM出金',
  reason: 'ATM出金は別処理',
};

function highClassification(): ClassificationResult & { stage?: 1 | 2 } {
  return {
    classified: true,
    category_id: 'communications',
    category_name_ja: '通信費',
    freee_account_code: 615,
    tax_code: 2,
    confidence: 'high',
    matched_keyword: 'AWS',
    match_reason: 'Matched keyword "AWS"',
    classifier_version: '1.0.0',
    stage: 1,
  };
}

function mediumClassification(): ClassificationResult & { stage?: 1 | 2 } {
  return { ...highClassification(), confidence: 'medium', stage: 2 };
}

function lowClassification(): ClassificationResult & { stage?: 1 | 2 } {
  return { ...highClassification(), confidence: 'low', stage: 2 };
}

const normalContext = { amount: 5000, is_new_partner: false, date: '2026-05-15' };

describe('ConfidenceRouter', () => {
  // Priority 1: hard stops
  it('should route excluded transactions to human_review', () => {
    const router = new ConfidenceRouter();
    const result = router.route(EXCLUDED, null, normalContext);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('excluded');
  });

  it('should route unclassified transactions to human_review', () => {
    const router = new ConfidenceRouter();
    const unclassified: ClassificationResult = {
      classified: false,
      confidence: 'none',
      match_reason: 'No match',
      classifier_version: '1.0.0',
    };
    const result = router.route(NOT_EXCLUDED, unclassified, normalContext);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('unclassified');
  });

  it('should route null classification to human_review', () => {
    const router = new ConfidenceRouter();
    const result = router.route(NOT_EXCLUDED, null, normalContext);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('unclassified');
  });

  it('should route high amount (> 1M JPY) to human_review', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 1_500_000, is_new_partner: false, date: '2026-05-15' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('high_amount');
  });

  it('should route new partner to human_review', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 5000, partner_name: '新規株式会社', is_new_partner: true, date: '2026-05-15' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('new_partner');
  });

  it('should route monthly close period (days 1-5) to human_review', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 5000, is_new_partner: false, date: '2026-05-03' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('monthly_close_period');
  });

  // Priority 2: confidence-based routing
  it('should auto_register high confidence transactions', () => {
    const router = new ConfidenceRouter();
    const result = router.route(NOT_EXCLUDED, highClassification(), normalContext);
    expect(result.action).toBe('auto_register');
    expect(result.flags).toEqual([]);
  });

  it('should auto_register_with_log medium confidence transactions', () => {
    const router = new ConfidenceRouter();
    const result = router.route(NOT_EXCLUDED, mediumClassification(), normalContext);
    expect(result.action).toBe('auto_register_with_log');
    expect(result.flags).toContain('medium_confidence');
  });

  it('should human_review low confidence transactions', () => {
    const router = new ConfidenceRouter();
    const result = router.route(NOT_EXCLUDED, lowClassification(), normalContext);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('low_confidence');
  });

  it('should human_review when confidence is "none"', () => {
    const router = new ConfidenceRouter();
    const cls = { ...highClassification(), classified: true, confidence: 'none' as const };
    const result = router.route(NOT_EXCLUDED, cls, normalContext);
    expect(result.action).toBe('human_review');
  });

  // Threshold boundary tests
  it('should allow exactly 1M JPY amount (not over threshold)', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 1_000_000, is_new_partner: false, date: '2026-05-15' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.action).toBe('auto_register');
  });

  it('should flag day 5 as monthly close period', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 5000, is_new_partner: false, date: '2026-05-05' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.flags).toContain('monthly_close_period');
  });

  it('should NOT flag day 6 as monthly close period', () => {
    const router = new ConfidenceRouter();
    const ctx = { amount: 5000, is_new_partner: false, date: '2026-05-06' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.flags).not.toContain('monthly_close_period');
  });

  // Config override
  it('should respect custom high_amount_threshold', () => {
    const router = new ConfidenceRouter({ high_amount_threshold: 500_000 });
    const ctx = { amount: 600_000, is_new_partner: false, date: '2026-05-15' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.action).toBe('human_review');
    expect(result.flags).toContain('high_amount');
  });

  it('should disable monthly close override when configured', () => {
    const router = new ConfidenceRouter({ monthly_close_override: false });
    const ctx = { amount: 5000, is_new_partner: false, date: '2026-05-01' };
    const result = router.route(NOT_EXCLUDED, highClassification(), ctx);
    expect(result.flags).not.toContain('monthly_close_period');
  });

  it('getConfig should return the current configuration', () => {
    const router = new ConfidenceRouter();
    const config = router.getConfig();
    expect(config.high_amount_threshold).toBe(1_000_000);
    expect(config.monthly_close_days).toEqual([1, 2, 3, 4, 5]);
  });
});
