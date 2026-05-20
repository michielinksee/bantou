// Confidence-based routing engine for the nightly batch pipeline.
//
// Implements the decision matrix from CLAUDE.md:
//
//   Priority 1 (hard stops — always human_review):
//     - Stage 0 excluded
//     - Unclassified (no category)
//     - Amount > 1,000,000 JPY
//     - New partner (取引先マスタ未登録)
//     - Monthly close period (1-5日)
//
//   Priority 2 (confidence-based):
//     - high   → auto_register (freee に自動仕訳)
//     - medium → auto_register_with_log (自動仕訳 + 確認queue mirror)
//     - low    → human_review (確認queue のみ)
//
// Practitioner playbook reference:
//   "過去 3 ヶ月以内に同じ取引先 + 同じ金額 ± 5% で同じ category 分類実績あり → AI 自動 OK"
//   "keyword 辞書 high confidence match → AI 自動 OK"
//   "100 万円超 → 税理士確認必須"
//   "新規取引先 → 税理士確認必須"

import { ClassificationResult, ExclusionResult } from '../classifier/types.js';
import { RoutingAction, RoutingDecision, RoutingFlag } from './types.js';

// ============================================================
// Context passed alongside classification results
// ============================================================

export interface RoutingContext {
  amount: number;
  partner_name?: string;
  is_new_partner: boolean;
  date: string;            // YYYY-MM-DD for monthly close detection
}

// ============================================================
// Configurable thresholds (per-firm override via CLAUDE.md)
// ============================================================

export interface RoutingConfig {
  /** Transactions above this amount → human_review regardless of confidence. Default: 1,000,000 JPY */
  high_amount_threshold: number;

  /** Days of month considered "monthly close period". Default: [1, 2, 3, 4, 5] */
  monthly_close_days: number[];

  /** Whether to enforce monthly close override. Default: true */
  monthly_close_override: boolean;
}

const DEFAULT_CONFIG: RoutingConfig = {
  high_amount_threshold: 1_000_000,
  monthly_close_days: [1, 2, 3, 4, 5],
  monthly_close_override: true,
};

// ============================================================
// Router
// ============================================================

export class ConfidenceRouter {
  private config: RoutingConfig;

  constructor(config: Partial<RoutingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Route a transaction to an action based on classification, exclusion, and business rules.
   *
   * @param exclusion - Result from ExclusionChecker.check()
   * @param classification - Result from TwoStageClassifier.classify() (null if exclusion hit)
   * @param context - Business context: amount, partner info, date
   * @returns RoutingDecision with action, reasons, and flags
   */
  route(
    exclusion: ExclusionResult,
    classification: (ClassificationResult & { stage?: 1 | 2 | 'unclassified' }) | null,
    context: RoutingContext,
  ): RoutingDecision {
    const flags: RoutingFlag[] = [];
    const reasons: string[] = [];

    // ── Priority 1: Hard-stop checks (force human_review) ──────────

    // 1. Stage 0 exclusion — 7 除外 rule に該当 = 絶対に自動 register しない
    if (exclusion.excluded) {
      flags.push('excluded');
      reasons.push(
        `Stage 0 除外: ${exclusion.rule_name_ja || exclusion.rule_id}`
        + (exclusion.reason ? ` — ${exclusion.reason}` : '')
      );
      return { action: 'human_review', reasons, flags };
    }

    // 2. Unclassified — keyword + AI ともにマッチせず
    if (!classification || !classification.classified) {
      flags.push('unclassified');
      reasons.push('分類不能: keyword辞書・AI fallback ともにマッチせず、人間判断が必要');
      return { action: 'human_review', reasons, flags };
    }

    // 3-5: Accumulate flags but don't return yet (multiple can apply)

    // 3. High amount (> 1,000,000 JPY)
    if (context.amount > this.config.high_amount_threshold) {
      flags.push('high_amount');
      reasons.push(
        `高額取引: ¥${context.amount.toLocaleString()}`
        + ` > ¥${this.config.high_amount_threshold.toLocaleString()} — 要確認`
      );
    }

    // 4. New partner — 取引先マスタ未登録
    if (context.is_new_partner && context.partner_name) {
      flags.push('new_partner');
      reasons.push(`新規取引先「${context.partner_name}」— 取引先マスタ未登録`);
    }

    // 5. Monthly close period (月初 1-5 日)
    if (this.config.monthly_close_override) {
      const day = this.extractDay(context.date);
      if (day > 0 && this.config.monthly_close_days.includes(day)) {
        flags.push('monthly_close_period');
        reasons.push(`月次決算期間 (${day}日) — 安全側で人間確認`);
      }
    }

    // Any hard-stop flag → force human_review regardless of confidence
    const hardStopFlags: RoutingFlag[] = ['high_amount', 'new_partner', 'monthly_close_period'];
    if (flags.some(f => hardStopFlags.includes(f))) {
      // Still report the classification result in reasons for context
      if (classification.category_name_ja) {
        reasons.push(
          `(参考) 分類結果: ${classification.category_name_ja}`
          + ` — confidence: ${classification.confidence}`
        );
      }
      return { action: 'human_review', reasons, flags };
    }

    // ── Priority 2: Confidence-based routing ───────────────────────

    switch (classification.confidence) {
      case 'high':
        reasons.push(
          `高信頼度: ${classification.category_name_ja}`
          + (classification.matched_keyword ? ` (keyword: "${classification.matched_keyword}")` : '')
        );
        return { action: 'auto_register', reasons, flags };

      case 'medium':
        flags.push('medium_confidence');
        reasons.push(
          `中信頼度: ${classification.category_name_ja}`
          + ` — 自動登録 + 確認キューに mirror`
        );
        return { action: 'auto_register_with_log', reasons, flags };

      case 'low':
        flags.push('low_confidence');
        reasons.push(
          `低信頼度: ${classification.category_name_ja}`
          + ` — AI の確信度が低いため人間判断が必要`
        );
        return { action: 'human_review', reasons, flags };

      default:
        // 'none' or unexpected value
        flags.push('unclassified');
        reasons.push('信頼度不明 — 人間判断が必要');
        return { action: 'human_review', reasons, flags };
    }
  }

  getConfig(): Readonly<RoutingConfig> {
    return this.config;
  }

  /**
   * Extract day-of-month from YYYY-MM-DD string without timezone ambiguity.
   * Avoids new Date() UTC/local issues by parsing the string directly.
   */
  private extractDay(dateStr: string): number {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      return isNaN(day) ? 0 : day;
    }
    return 0;
  }
}
