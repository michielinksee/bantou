// Nightly batch pipeline orchestrator.
//
// Faithfully reproduces the 60-company nightly batch pattern:
//
//   [21:00] Anthropic Routine → "今日の N 社 自動仕訳 batch を実行して"
//   [21:00] list_companies() → N company IDs
//   [21:01] Per company (concurrency-limited parallel):
//           fetch_unprocessed → exclusion → classify → confidence route → (register)
//   [21:50] Summary → Slack DM
//
// Key design decisions:
//
//   1. Concurrency limit (default 3) — freee API rate limit = 3600 req/h (= 60/min).
//      With ~10 deals/company × ~2 API calls/deal, 3 concurrent companies stays safe.
//
//   2. Promise.allSettled per batch — one company failure doesn't kill the run.
//      Error is captured in CompanyBatchResult, pipeline continues.
//
//   3. Memo extraction fallback chain — freee /deals list API quirk:
//      memo || description || details[0].description || ref_number || ''
//
//   4. Partner detection — fetches existing partners per company, checks if
//      deal.partner_name is in master. New partners → human_review.
//
//   5. Dry-run by default — Phase 1.A doesn't write back to freee.
//      Write-back (freee.register_journal) deferred to Phase 1.B.

import { FreeeConnector, FreeeCompany, FreeeDeal } from '../connectors/freee.js';
import { TwoStageClassifier } from '../classifier/two-stage-classifier.js';
import { TwoStageResult } from '../classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../exclusion/exclusion-checker.js';
import { Transaction } from '../classifier/types.js';
import { ConfidenceRouter, RoutingContext } from './confidence-router.js';
import { CockpitMemory } from '../memory/cockpit-memory.js';
import {
  NightlyRunResult,
  CompanyBatchResult,
  ProcessedTransaction,
} from './types.js';

// ============================================================
// Configuration
// ============================================================

export interface NightlyPipelineConfig {
  /** Always true in Phase 1.A — write-back pending Phase 1.B */
  dry_run: boolean;

  /** Max companies processed in parallel. Default: 3 (freee rate limit safe) */
  concurrency: number;

  /** Max deals fetched per company. Default: 100 */
  deals_per_company: number;

  /** Override: only process these company IDs (default: all accessible) */
  company_ids?: number[];

  /** Optional date range filter (YYYY-MM-DD) */
  period_start?: string;
  period_end?: string;
}

const DEFAULT_CONFIG: NightlyPipelineConfig = {
  dry_run: true,
  concurrency: 3,
  deals_per_company: 100,
};

// ============================================================
// Pipeline
// ============================================================

export class NightlyPipeline {
  private connector: FreeeConnector;
  private classifier: TwoStageClassifier;
  private exclusion: ExclusionChecker;
  private router: ConfidenceRouter;
  private memory: CockpitMemory | null;
  private config: NightlyPipelineConfig;

  constructor(
    connector: FreeeConnector,
    classifier: TwoStageClassifier,
    exclusion: ExclusionChecker,
    config: Partial<NightlyPipelineConfig> = {},
    memory?: CockpitMemory,
  ) {
    this.connector = connector;
    this.classifier = classifier;
    this.exclusion = exclusion;
    this.router = new ConfidenceRouter();
    this.memory = memory || null;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the full Full nightly batch.
   *
   * Pipeline:
   *   1. List all accessible companies (or use override list)
   *   2. For each company (concurrency-limited parallel):
   *      a. Fetch unprocessed deals (status = 'unsettled')
   *      b. Fetch existing partners (for new-partner detection)
   *      c. For each deal: exclusion → classify → route
   *      d. Aggregate per-company results
   *   3. Aggregate all company results
   *   4. Generate Batch summary (Slack-ready format)
   */
  async run(): Promise<NightlyRunResult> {
    const startedAt = new Date().toISOString();

    // ── Step 1: Determine target companies ──────────────────────

    let companies: FreeeCompany[];

    if (this.config.company_ids && this.config.company_ids.length > 0) {
      // Explicit company list provided — create minimal objects
      companies = this.config.company_ids.map(id => ({
        id,
        display_name: `Company ${id}`,
        tax_at_source_calc_type: 0,
        contact_name: '',
      }));
    } else {
      // Discover all accessible companies from the token
      try {
        companies = await this.connector.listCompanies();
      } catch (err: any) {
        // Fallback: use default company from secrets (= single-company mode)
        companies = [{
          id: this.connector.companyId,
          display_name: this.connector.companyName || `Company ${this.connector.companyId}`,
          tax_at_source_calc_type: 0,
          contact_name: '',
        }];
      }
    }

    // ── Step 2: Process companies with concurrency control ──────

    const companyResults: CompanyBatchResult[] = [];
    const batches = chunkArray(companies, this.config.concurrency);

    for (const batch of batches) {
      const settled = await Promise.allSettled(
        batch.map(company => this.processCompany(company))
      );

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status === 'fulfilled') {
          companyResults.push(result.value);
        } else {
          // Entire company processing failed — capture error, continue
          companyResults.push({
            company_id: batch[i].id,
            company_name: batch[i].display_name,
            total_deals: 0,
            processing_time_ms: 0,
            ok: false,
            error: result.reason?.message || String(result.reason),
            summary: emptySummary(),
            confidence_breakdown: { high: 0, medium: 0, low: 0, none: 0 },
            review_queue: [],
            sample: [],
          });
        }
      }
    }

    // ── Step 3: Aggregate ──────────────────────────────────────

    const aggregate = aggregateResults(companyResults);
    const totalDeals = companyResults.reduce((sum, c) => sum + c.total_deals, 0);
    const finishedAt = new Date().toISOString();

    // ── Step 4: Build Slack-ready summary ──────────────────────

    const memoryStats = this.memory?.getStats() || null;
    const slackSummary = buildSlackSummary(
      companyResults, aggregate, startedAt, finishedAt, this.config.dry_run, memoryStats
    );

    // ── Assemble final result ──────────────────────────────────

    const s1 = this.classifier.getStage1();
    const s2 = this.classifier.getStage2();

    return {
      ok: companyResults.some(c => c.ok), // OK if at least one company succeeded
      dry_run: this.config.dry_run,
      started_at: startedAt,
      finished_at: finishedAt,
      total_companies: companies.length,
      total_deals: totalDeals,
      aggregate,
      companies: companyResults,
      classifier: {
        stage1_version: s1.getVersion(),
        stage1_keywords: s1.getKeywordsCount(),
        stage1_categories: s1.getCategoriesCount(),
        stage2_enabled: this.classifier.hasStage2(),
        stage2_model: s2?.getModel() || null,
      },
      exclusion_version: this.exclusion.getVersion(),
      slack_summary: slackSummary,
      note: this.config.dry_run
        ? 'Phase 1.A dry-run — write-back to freee pending Phase 1.B.'
        : 'Live mode — transactions registered to freee.',
    };
  }

  // ============================================================
  // Per-company processing
  // ============================================================

  private async processCompany(company: FreeeCompany): Promise<CompanyBatchResult> {
    const t0 = Date.now();
    const companyId = company.id;

    // Fetch unprocessed deals (Step 3: status='unsettled' filter)
    const deals = await this.connector.listDeals({
      company_id: companyId,
      status: 'unsettled',
      start_issue_date: this.config.period_start,
      end_issue_date: this.config.period_end,
      limit: this.config.deals_per_company,
    });

    // Fetch existing partners for new-partner detection
    // (Best-effort: if this fails, treat all partners as existing = safer)
    let knownPartners: Set<string>;
    try {
      const partners = await this.connector.listPartners({
        company_id: companyId,
        limit: 500,
      });
      knownPartners = new Set(partners.map(p => p.name));
    } catch {
      knownPartners = new Set();
    }

    // Process each deal through the pipeline
    const processed: ProcessedTransaction[] = [];
    const summary = emptySummary();
    const confidence = { high: 0, medium: 0, low: 0, none: 0 };

    for (const deal of deals) {
      try {
        const pt = await this.processDeal(deal, companyId, knownPartners);
        processed.push(pt);

        // Update summary counters
        if (pt.excluded) {
          summary.excluded++;
        } else if (!pt.classified) {
          summary.unclassified++;
        } else {
          if (pt.stage === 1) summary.classified_stage1++;
          else if (pt.stage === 2) summary.classified_stage2++;
        }

        // Confidence counter (including excluded = 'none')
        const conf = pt.confidence || 'none';
        if (conf in confidence) confidence[conf as keyof typeof confidence]++;

        // Routing action counter
        switch (pt.routing.action) {
          case 'auto_register':
            summary.auto_registered++;
            break;
          case 'auto_register_with_log':
            summary.auto_registered_with_log++;
            break;
          case 'human_review':
            summary.human_review++;
            break;
        }
      } catch (err: any) {
        summary.errors++;
        processed.push(
          makeErrorTransaction(deal, companyId, err?.message || String(err))
        );
      }
    }

    // Build review queue: all items that need human attention
    const reviewQueue = processed.filter(
      p => p.routing.action === 'human_review'
        || p.routing.action === 'auto_register_with_log'
    );

    // Sample: first 5 transactions for summary display
    const sample = processed.slice(0, 5);

    // Save memory after processing each company (batch-level persistence)
    if (this.memory) {
      this.memory.save();
    }

    return {
      company_id: companyId,
      company_name: company.display_name,
      total_deals: deals.length,
      processing_time_ms: Date.now() - t0,
      ok: summary.errors === 0,
      summary,
      confidence_breakdown: confidence,
      review_queue: reviewQueue,
      sample,
    };
  }

  // ============================================================
  // Per-deal processing
  // ============================================================

  private async processDeal(
    deal: FreeeDeal,
    companyId: number,
    knownPartners: Set<string>,
  ): Promise<ProcessedTransaction> {
    // Extract memo (freee API quirk: details[0].description is the real memo)
    const memo = deal.memo
      || deal.description
      || (deal.details?.[0]?.description)
      || deal.ref_number
      || '';

    const tx: Transaction = {
      amount: deal.amount,
      memo,
      date: deal.issue_date,
      partner_name: deal.partner_name,
      company_id: companyId,
    };

    // ── Stage 0: Exclusion check ──

    const exc = this.exclusion.check(tx);

    if (exc.excluded) {
      const routing = this.router.route(exc, null, {
        amount: deal.amount,
        partner_name: deal.partner_name,
        is_new_partner: false,
        date: deal.issue_date,
      });
      return {
        deal_id: deal.id,
        company_id: companyId,
        issue_date: deal.issue_date,
        amount: deal.amount,
        memo,
        partner_name: deal.partner_name,
        excluded: true,
        exclusion_rule: exc.rule_id,
        exclusion_reason: exc.reason,
        classified: false,
        confidence: 'none',
        routing,
      };
    }

    // ── Memory recall: check past patterns before classification ──
    //
    // Rule: "過去パターン一致 → AI 処理 OK"
    // If memory finds a correction or pattern, skip classification entirely.

    if (this.memory) {
      const recall = this.memory.recallPattern(tx);

      if (recall.found && recall.source === 'correction' && recall.correction) {
        // Correction hit — use corrected category, always high confidence
        const isNewPartner = Boolean(
          deal.partner_name && deal.partner_name.trim() !== ''
          && !knownPartners.has(deal.partner_name)
        );
        const routing = this.router.route(
          { excluded: false },
          {
            classified: true,
            category_id: recall.correction.to_category_id,
            category_name_ja: recall.correction.to_category_name_ja,
            freee_account_code: recall.correction.to_freee_account_code,
            tax_code: recall.correction.to_tax_code,
            confidence: 'high',
            match_reason: recall.reason,
            classifier_version: 'memory-correction',
          },
          { amount: deal.amount, partner_name: deal.partner_name, is_new_partner: isNewPartner, date: deal.issue_date },
        );

        return {
          deal_id: deal.id,
          company_id: companyId,
          issue_date: deal.issue_date,
          amount: deal.amount,
          memo,
          partner_name: deal.partner_name,
          excluded: false,
          classified: true,
          category_id: recall.correction.to_category_id,
          category_name_ja: recall.correction.to_category_name_ja,
          confidence: 'high',
          memory_source: 'correction',
          memory_pattern_key: recall.correction.partner_key,
          routing,
        };
      }

      if (recall.found && recall.source === 'pattern' && recall.pattern) {
        // Pattern hit — use remembered classification
        const isNewPartner = Boolean(
          deal.partner_name && deal.partner_name.trim() !== ''
          && !knownPartners.has(deal.partner_name)
        );
        const routing = this.router.route(
          { excluded: false },
          {
            classified: true,
            category_id: recall.pattern.category_id,
            category_name_ja: recall.pattern.category_name_ja,
            freee_account_code: recall.pattern.freee_account_code,
            tax_code: recall.pattern.tax_code,
            confidence: recall.confidence,
            match_reason: recall.reason,
            classifier_version: 'memory-pattern',
          },
          { amount: deal.amount, partner_name: deal.partner_name, is_new_partner: isNewPartner, date: deal.issue_date },
        );

        // Update pattern match count
        recall.pattern.match_count++;
        recall.pattern.last_seen = new Date().toISOString().slice(0, 10);

        return {
          deal_id: deal.id,
          company_id: companyId,
          issue_date: deal.issue_date,
          amount: deal.amount,
          memo,
          partner_name: deal.partner_name,
          excluded: false,
          classified: true,
          category_id: recall.pattern.category_id,
          category_name_ja: recall.pattern.category_name_ja,
          confidence: recall.confidence,
          memory_source: 'pattern',
          memory_pattern_key: recall.pattern.partner_key,
          memory_match_count: recall.pattern.match_count,
          routing,
        };
      }
    }

    // ── Stage 1 + 2: Two-stage classification (memory miss) ──

    const cls: TwoStageResult = await this.classifier.classify(tx);

    // ── New partner detection ──

    const isNewPartner = Boolean(
      deal.partner_name && deal.partner_name.trim() !== ''
      && !knownPartners.has(deal.partner_name)
    );

    // ── Confidence routing ──

    const routingContext: RoutingContext = {
      amount: deal.amount,
      partner_name: deal.partner_name,
      is_new_partner: isNewPartner,
      date: deal.issue_date,
    };

    const routing = this.router.route({ excluded: false }, cls, routingContext);

    // ── Remember classification for future recall ──
    //
    // Only remember successful classifications (auto_register / auto_register_with_log).
    // Don't remember human_review items — those need human judgment first.

    if (this.memory && cls.classified && (routing.action === 'auto_register' || routing.action === 'auto_register_with_log')) {
      this.memory.rememberClassification(
        tx,
        cls.category_id!,
        cls.category_name_ja!,
        cls.confidence,
        cls.stage === 1 ? 'keyword' : 'claude',
        cls.freee_account_code,
        typeof cls.tax_code === 'number' ? cls.tax_code : undefined,
      );
    }

    return {
      deal_id: deal.id,
      company_id: companyId,
      issue_date: deal.issue_date,
      amount: deal.amount,
      memo,
      partner_name: deal.partner_name,
      excluded: false,
      classified: cls.classified,
      stage: cls.stage === 'unclassified' ? undefined : cls.stage as 1 | 2,
      category_id: cls.category_id,
      category_name_ja: cls.category_name_ja,
      confidence: cls.confidence,
      matched_keyword: cls.matched_keyword,
      routing,
    };
  }
}

// ============================================================
// Pure helper functions (no state)
// ============================================================

function emptySummary() {
  return {
    auto_registered: 0,
    auto_registered_with_log: 0,
    human_review: 0,
    excluded: 0,
    classified_stage1: 0,
    classified_stage2: 0,
    unclassified: 0,
    errors: 0,
  };
}

function aggregateResults(companies: CompanyBatchResult[]) {
  const agg = emptySummary();
  for (const c of companies) {
    agg.auto_registered += c.summary.auto_registered;
    agg.auto_registered_with_log += c.summary.auto_registered_with_log;
    agg.human_review += c.summary.human_review;
    agg.excluded += c.summary.excluded;
    agg.classified_stage1 += c.summary.classified_stage1;
    agg.classified_stage2 += c.summary.classified_stage2;
    agg.unclassified += c.summary.unclassified;
    agg.errors += c.summary.errors;
  }
  return agg;
}

/**
 * Build Batch summary (Slack-ready format).
 *
 * Target format (practitioner-proven Slack notification):
 *   Cockpit nightly run 完了 (21:50 JST):
 *   - 全 60 社 / 計 750 件 処理
 *   - 自動 register: 712 件 (high/medium confidence)
 *   - 確認待ち: 38 件
 *   - エラー: 0 件
 *   - 処理時間: 50 分
 */
function buildSlackSummary(
  companies: CompanyBatchResult[],
  aggregate: ReturnType<typeof emptySummary>,
  startedAt: string,
  finishedAt: string,
  dryRun: boolean,
  memoryStats?: { pattern_hits: number; correction_hits: number; cache_misses: number } | null,
): string {
  const totalDeals = companies.reduce((s, c) => s + c.total_deals, 0);
  const autoTotal = aggregate.auto_registered + aggregate.auto_registered_with_log;
  const elapsedMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  const elapsedSec = (elapsedMs / 1000).toFixed(1);
  const elapsedMin = (elapsedMs / 60000).toFixed(1);
  const elapsedDisplay = elapsedMs >= 60000 ? `${elapsedMin} 分` : `${elapsedSec} 秒`;

  // JST timestamp for display
  const finishedJST = new Date(new Date(finishedAt).getTime() + 9 * 3600 * 1000)
    .toISOString().slice(11, 16);

  const lines = [
    `Cockpit nightly run 完了 (${finishedJST} JST):`,
    `- 全 ${companies.length} 社 / 計 ${totalDeals} 件 処理`,
    `- 自動 register: ${autoTotal} 件 (high: ${aggregate.auto_registered}, medium+log: ${aggregate.auto_registered_with_log})`,
    `- 確認待ち: ${aggregate.human_review} 件 (low + exclusion + 高額 + 新規取引先)`,
    `- 除外: ${aggregate.excluded} 件 (Stage 0 exclusion)`,
    `- 分類: Stage 1 = ${aggregate.classified_stage1} 件, Stage 2 = ${aggregate.classified_stage2} 件, 未分類 = ${aggregate.unclassified} 件`,
    `- エラー: ${aggregate.errors} 件`,
    `- 処理時間: ${elapsedDisplay}`,
  ];

  // Memory stats (if available)
  if (memoryStats) {
    const memTotal = memoryStats.pattern_hits + memoryStats.correction_hits + memoryStats.cache_misses;
    if (memTotal > 0) {
      lines.push(`- Memory: pattern hit ${memoryStats.pattern_hits} / correction hit ${memoryStats.correction_hits} / miss ${memoryStats.cache_misses}`);
    }
  }

  if (dryRun) {
    lines.push('- [DRY RUN] freee への書き込みは行っていません');
  }

  // Report failed companies
  const failed = companies.filter(c => !c.ok);
  if (failed.length > 0) {
    lines.push(
      `- 失敗: ${failed.map(c => `${c.company_name} (${c.error?.slice(0, 60) || 'unknown'})`).join(', ')}`
    );
  }

  return lines.join('\n');
}

function makeErrorTransaction(
  deal: FreeeDeal,
  companyId: number,
  error: string,
): ProcessedTransaction {
  return {
    deal_id: deal.id,
    company_id: companyId,
    issue_date: deal.issue_date,
    amount: deal.amount,
    memo: deal.memo || deal.description || '',
    partner_name: deal.partner_name,
    excluded: false,
    classified: false,
    confidence: 'none',
    routing: {
      action: 'human_review',
      reasons: [`Pipeline error: ${error}`],
      flags: [],
    },
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
