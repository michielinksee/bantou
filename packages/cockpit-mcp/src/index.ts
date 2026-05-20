#!/usr/bin/env node
// @kansei-link/cockpit — Pre-built accounting automation MCP server for Japanese tax firms.
//
// Tools (v0.0.5-pre):
//   - classify_transaction:    Stage 1 keyword + Stage 2 Claude API fallback
//   - check_exclusion:         Stage 0 = 7-rule exclusion filter
//   - import_csv:              Multi-platform CSV import (弥生/freee/MF/汎用) + classification pipeline
//   - generate_monthly_report: Monthly review report generation
//   - correct_classification:  税理士修正フィードバック (Memory caveat layer — 永続記憶)
//   - recall_memory:           過去パターン・修正履歴検索
//   - list_freee_deals:        List transactions from freee API
//   - list_freee_companies:    List all companies accessible by token (multi-company batch)
//   - reconcile_cross_saas:    freee ↔ MF double-entry detection (= MF connector pending)
//   - check_duplicate:         Existing transaction lookup in target SaaS
//   - upsert_partner:          取引先 master auto-creation
//   - nightly_run:             Nightly batch pipeline orchestrator (Memory-enabled)
//
// Architecture: see kansei-link-cockpit/docs/architecture.md

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadFreeeSecrets } from './secrets.js';
import { FreeeConnector } from './connectors/freee.js';
import { KeywordClassifier } from './classifier/keyword-classifier.js';
import { ClaudeClassifier } from './classifier/claude-classifier.js';
import { TwoStageClassifier } from './classifier/two-stage-classifier.js';
import { ExclusionChecker } from './exclusion/exclusion-checker.js';
import { NightlyPipeline } from './pipeline/nightly-pipeline.js';
import { ConfidenceRouter } from './pipeline/confidence-router.js';
import { Transaction } from './classifier/types.js';
import { importCsv } from './adapters/index.js';
import { CsvSource, ColumnMapping } from './adapters/types.js';
import { generateMonthlyReport } from './reports/monthly-report.js';
import { CockpitMemory } from './memory/cockpit-memory.js';
import { TaxRuleEngine } from './tax-rules/tax-rule-engine.js';

const SERVER_VERSION = '0.1.0';

// Lazy-init: load Stage 1 + Stage 2 at startup. Stage 2 optional (= requires ANTHROPIC_API_KEY).
const keywordClassifier = new KeywordClassifier();
const claudeApiKey = process.env.ANTHROPIC_API_KEY || '';
const claudeClassifier = claudeApiKey
  ? new ClaudeClassifier(claudeApiKey, keywordClassifier.getCategoriesMeta())
  : null;
const classifier = new TwoStageClassifier(keywordClassifier, claudeClassifier);
const exclusion = new ExclusionChecker();
const confidenceRouter = new ConfidenceRouter();
const memory = new CockpitMemory();
const taxRuleEngine = new TaxRuleEngine();

let freeeConnector: FreeeConnector | null = null;
function getFreeeConnector(): FreeeConnector {
  if (!freeeConnector) {
    const secrets = loadFreeeSecrets();
    freeeConnector = new FreeeConnector(secrets);
  }
  return freeeConnector;
}

const server = new Server(
  { name: '@kansei-link/cockpit', version: SERVER_VERSION },
  {
    capabilities: {
      tools: {},
    },
  }
);

const TOOLS = [
  {
    name: 'classify_transaction',
    description:
      'Two-stage classifier for Japanese tax accounting. Stage 1: keyword dictionary match (14 categories × ~50 keywords). Stage 2 (= deferred to Phase 1.B): Claude API fallback. Returns 勘定科目 + 税区分 + confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Transaction amount (JPY)' },
        memo: { type: 'string', description: '取引摘要' },
        date: { type: 'string', description: 'ISO 8601 date YYYY-MM-DD' },
        partner_name: { type: 'string', description: '取引先名 (optional)' },
      },
      required: ['amount', 'memo', 'date'],
    },
  },
  {
    name: 'check_exclusion',
    description:
      '7-rule exclusion check for Japanese accounting. Returns excluded:true if transaction should NOT be auto-journalized. Rules: 内容不明デビット / 借入金返済 / 社保税金 / 給与支払い / 投資 / ATM出金 / 公共料金.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        memo: { type: 'string' },
        partner_name: { type: 'string' },
        employees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional employee name list (= for salary_payment detection)',
        },
      },
      required: ['amount', 'memo'],
    },
  },
  {
    name: 'import_csv',
    description:
      'Import CSV from 弥生会計/freee/MoneyForward or generic format. Auto-detects source format from headers. Runs each transaction through the full classification pipeline (Stage 0 exclusion → Stage 1+2 classification → confidence routing). Returns categorized results + review queue + Markdown report. 弥生 users: export 仕訳日記帳 as UTF-8 CSV.',
    inputSchema: {
      type: 'object',
      properties: {
        csv_content: { type: 'string', description: 'Raw CSV text (UTF-8). Paste the full CSV content.' },
        source: {
          type: 'string',
          enum: ['yayoi', 'freee_export', 'mf_export', 'generic'],
          description: 'Force source format (default: auto-detect from headers)',
        },
        date_column: { type: 'string', description: 'Column name for date (generic CSV only)' },
        amount_column: { type: 'string', description: 'Column name for amount (generic CSV only)' },
        memo_column: { type: 'string', description: 'Column name for memo/description (generic CSV only)' },
        partner_column: { type: 'string', description: 'Column name for partner name (generic CSV only, optional)' },
      },
      required: ['csv_content'],
    },
  },
  {
    name: 'generate_monthly_report',
    description:
      'Generate a monthly review report. Takes transaction data (from freee API or CSV import), classifies all transactions, detects anomalies, and produces a structured Markdown report with category breakdown, anomaly alerts, and review items. Designed for tax accountants to present to clients.',
    inputSchema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: '会社名 / 顧問先名' },
        month: { type: 'string', description: 'Target month YYYY-MM (e.g. "2026-05")' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              memo: { type: 'string' },
              date: { type: 'string' },
              partner_name: { type: 'string' },
            },
            required: ['amount', 'memo', 'date'],
          },
          description: 'Array of transactions to analyze. If omitted, fetches from freee API for the given month.',
        },
        compare_transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              amount: { type: 'number' },
              memo: { type: 'string' },
              date: { type: 'string' },
              partner_name: { type: 'string' },
            },
            required: ['amount', 'memo', 'date'],
          },
          description: 'Previous period transactions for comparison (optional)',
        },
        compare_label: { type: 'string', description: 'Comparison label (e.g. "前月", "前年同月")', default: '前月' },
        format: { type: 'string', enum: ['markdown', 'json'], default: 'markdown' },
        use_freee: { type: 'boolean', description: 'Fetch transactions from freee API instead of providing them', default: false },
      },
      required: ['month'],
    },
  },
  {
    name: 'list_freee_deals',
    description:
      'List transactions (取引) from freee API for the configured company. Useful for sync + classification dogfood.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['income', 'expense'], description: 'Filter by income or expense' },
        start_issue_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_issue_date: { type: 'string', description: 'YYYY-MM-DD' },
        limit: { type: 'number', default: 20 },
        offset: { type: 'number', default: 0 },
      },
    },
  },
  {
    name: 'list_freee_companies',
    description:
      'List all companies (事業所) accessible by the configured freee OAuth token. Returns company IDs + names. Used for multi-company batch processing.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reconcile_cross_saas',
    description:
      'Cross-SaaS reconciliation (= freee ↔ MF). Currently freee-only mode (= MF connector pending Phase 1.B). Detects duplicate fingerprints within freee.',
    inputSchema: {
      type: 'object',
      properties: {
        period_start: { type: 'string' },
        period_end: { type: 'string' },
      },
      required: ['period_start', 'period_end'],
    },
  },
  {
    name: 'check_duplicate',
    description:
      'Check if a transaction already exists in freee (= by date + amount + memo prefix). Use BEFORE register to prevent double-posting.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        amount: { type: 'number' },
        memo: { type: 'string' },
      },
      required: ['date', 'amount', 'memo'],
    },
  },
  {
    name: 'upsert_partner',
    description:
      '取引先マスタ auto-creation in freee. Fuzzy match against existing partners; if new, create. Returns partner_id.',
    inputSchema: {
      type: 'object',
      properties: {
        partner_name: { type: 'string' },
      },
      required: ['partner_name'],
    },
  },
  {
    name: 'correct_classification',
    description:
      '税理士修正フィードバック。誤分類を記録し、同パターンの取引が今後来たら修正後の勘定科目を自動適用。Linksee Memory caveat layer と同等（= 永続記憶、二度と同じ誤りをしない）。修正は全社共通 or 特定会社のみに適用可能。',
    inputSchema: {
      type: 'object',
      properties: {
        memo_pattern: { type: 'string', description: 'この修正が適用される摘要パターン（例: "スターバックス 渋谷"）' },
        partner_name: { type: 'string', description: '取引先名（optional — memo_pattern だけでもOK）' },
        from_category_id: { type: 'string', description: '誤分類だった勘定科目ID（optional）' },
        from_category_name_ja: { type: 'string', description: '誤分類だった勘定科目名（optional）' },
        to_category_id: { type: 'string', description: '正しい勘定科目ID' },
        to_category_name_ja: { type: 'string', description: '正しい勘定科目名' },
        reason: { type: 'string', description: '修正理由（例: "1人利用・5,000円以下は会議費"）' },
        company_id: { type: 'number', description: '特定会社のみに適用（省略 = 全社共通）' },
      },
      required: ['memo_pattern', 'to_category_id', 'to_category_name_ja', 'reason'],
    },
  },
  {
    name: 'recall_memory',
    description:
      '過去の分類パターン・修正履歴を検索。取引の摘要/取引先から過去パターンを参照し、分類結果の根拠を確認。Memory stats（pattern hit率等）の確認にも使用。',
    inputSchema: {
      type: 'object',
      properties: {
        memo: { type: 'string', description: '取引摘要（パターン検索用）' },
        partner_name: { type: 'string', description: '取引先名（optional）' },
        amount: { type: 'number', description: '金額（±5% 範囲でマッチ）' },
        show_stats: { type: 'boolean', description: 'Memory 全体統計を表示', default: false },
        show_corrections: { type: 'boolean', description: '全修正履歴を表示', default: false },
      },
    },
  },
  {
    name: 'nightly_run',
    description:
      'Nightly batch pipeline. Processes ALL companies accessible by the token (= multi-company batch). Pipeline per company: fetch unprocessed (status=unsettled) → Stage 0 exclusion → Stage 1+2 classify → confidence routing (high=auto, medium=auto+log, low=human_review) → aggregate summary. Currently dry-run only (write-back pending Phase 1.B).',
    inputSchema: {
      type: 'object',
      properties: {
        dry_run: { type: 'boolean', default: true, description: 'Currently always dry_run (= write-back pending Phase 1.B)' },
        company_ids: { type: 'array', items: { type: 'number' }, description: 'Override: process only these company IDs (default: all accessible)' },
        concurrency: { type: 'number', default: 3, description: 'Max parallel companies (default: 3, freee rate limit safe)' },
        deals_per_company: { type: 'number', default: 100, description: 'Max deals fetched per company' },
        period_start: { type: 'string', description: 'YYYY-MM-DD start date filter' },
        period_end: { type: 'string', description: 'YYYY-MM-DD end date filter' },
      },
    },
  },
];

// ============================================================
// Handlers
// ============================================================

async function handleClassifyTransaction(args: any): Promise<string> {
  const tx: Transaction = {
    amount: args.amount,
    memo: args.memo,
    date: args.date,
    partner_name: args.partner_name,
  };
  const result = await classifier.classify(tx);
  return JSON.stringify({ ok: true, ...result }, null, 2);
}

function handleCheckExclusion(args: any): string {
  const tx: Transaction = {
    amount: args.amount,
    memo: args.memo,
    date: args.date || '',
    partner_name: args.partner_name,
  };
  const result = exclusion.check(tx, args.employees);
  return JSON.stringify({ ok: true, ...result }, null, 2);
}

async function handleImportCsv(args: any): Promise<string> {
  const csvContent = String(args.csv_content || '');
  if (!csvContent.trim()) {
    return JSON.stringify({ ok: false, error: 'csv_content is empty' }, null, 2);
  }

  const mapping: ColumnMapping | undefined =
    args.date_column && args.amount_column && args.memo_column
      ? {
          date: args.date_column,
          amount: args.amount_column,
          memo: args.memo_column,
          partner_name: args.partner_column,
        }
      : undefined;

  const result = await importCsv(csvContent, classifier, exclusion, confidenceRouter, {
    source: args.source as CsvSource | undefined,
    mapping,
    memory,
    taxRuleEngine,
  });

  // Trim per-transaction details for response size management.
  // Keep summary + review items + markdown report.
  return JSON.stringify({
    ok: result.ok,
    source: result.source,
    source_label: result.source_label,
    total_rows: result.total_rows,
    parsed_count: result.parsed_count,
    skipped_count: result.skipped_count,
    warnings: result.warnings.slice(0, 20),
    summary: result.summary,
    review_queue: result.human_review.slice(0, 30).map(ct => ({
      row: ct.row_number,
      date: ct.transaction.date,
      amount: ct.transaction.amount,
      memo: ct.transaction.memo,
      flags: ct.routing_flags,
    })),
    excluded_sample: result.excluded.slice(0, 10).map(ct => ({
      row: ct.row_number,
      memo: ct.transaction.memo,
      rule: ct.exclusion_rule,
    })),
    auto_sample: result.auto_register.slice(0, 10).map(ct => ({
      row: ct.row_number,
      memo: ct.transaction.memo,
      category: ct.category_name_ja,
      confidence: ct.confidence,
    })),
    markdown_report: result.markdown_report,
    csv_output_preview: result.csv_output?.split('\n').slice(0, 5).join('\n'),
  }, null, 2);
}

async function handleGenerateMonthlyReport(args: any): Promise<string> {
  const month = String(args.month || '');
  if (!month.match(/^\d{4}-\d{2}$/)) {
    return JSON.stringify({ ok: false, error: 'month must be YYYY-MM format' }, null, 2);
  }

  let transactions: Transaction[] = args.transactions || [];

  // If use_freee = true and no transactions provided, fetch from freee
  if (args.use_freee && transactions.length === 0) {
    try {
      const conn = getFreeeConnector();
      const [year, mon] = month.split('-');
      const startDate = `${year}-${mon}-01`;
      // Calculate last day of month
      const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
      const endDate = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

      const deals = await conn.listDeals({
        start_issue_date: startDate,
        end_issue_date: endDate,
        limit: 500,
      });

      transactions = deals.map(d => ({
        amount: d.amount,
        memo: d.memo || d.description || d.details?.[0]?.description || d.ref_number || '',
        date: d.issue_date,
        partner_name: d.partner_name,
      }));
    } catch (err: any) {
      return JSON.stringify({
        ok: false,
        error: `Failed to fetch from freee: ${err.message}. Provide transactions directly or fix freee connection.`,
      }, null, 2);
    }
  }

  if (transactions.length === 0) {
    return JSON.stringify({
      ok: false,
      error: 'No transactions provided. Either pass transactions array or set use_freee=true.',
    }, null, 2);
  }

  const compareTransactions: Transaction[] = args.compare_transactions || [];

  const result = await generateMonthlyReport(
    transactions,
    classifier,
    exclusion,
    confidenceRouter,
    {
      company_name: args.company_name,
      month,
      compare_transactions: compareTransactions.length > 0 ? compareTransactions : undefined,
      compare_label: args.compare_label || '前月',
      format: args.format || 'markdown',
    },
  );

  // Return structured result with markdown
  return JSON.stringify({
    ok: result.ok,
    company_name: result.company_name,
    month: result.month,
    total_transactions: result.total_transactions,
    total_expense: result.total_expense,
    classification_rate: result.classification_rate,
    auto_register_rate: result.auto_register_rate,
    anomaly_count: result.anomalies.length,
    anomalies: result.anomalies,
    review_count: result.review_items.length,
    category_summary: result.categories.map(c => ({
      category: c.category_name_ja,
      count: c.count,
      total: c.total_amount,
    })),
    markdown: result.markdown,
  }, null, 2);
}

function handleCorrectClassification(args: any): string {
  const record = memory.rememberCorrection({
    memo_pattern: args.memo_pattern,
    partner_name: args.partner_name,
    from_category_id: args.from_category_id,
    from_category_name_ja: args.from_category_name_ja,
    to_category_id: args.to_category_id,
    to_category_name_ja: args.to_category_name_ja,
    reason: args.reason,
    company_id: args.company_id,
  });
  memory.save();

  return JSON.stringify({
    ok: true,
    correction_id: record.id,
    partner_key: record.partner_key,
    memo_pattern: record.memo_pattern,
    from: record.from_category_name_ja || '(不明)',
    to: record.to_category_name_ja,
    reason: record.reason,
    scope: record.company_id ? `Company ${record.company_id} のみ` : '全社共通',
    note: 'この修正は今後の分類で自動適用されます（caveat layer = 永続記憶）',
    stats: memory.getStats(),
  }, null, 2);
}

function handleRecallMemory(args: any): string {
  const result: any = { ok: true };

  // Pattern recall
  if (args.memo || args.partner_name) {
    const tx = {
      amount: args.amount || 0,
      memo: args.memo || '',
      date: new Date().toISOString().slice(0, 10),
      partner_name: args.partner_name,
    };
    const recall = memory.recallPattern(tx);
    result.recall = recall;
  }

  // Stats
  if (args.show_stats) {
    result.stats = memory.getStats();
    result.total_patterns = memory.getPatternCount();
    result.total_corrections = memory.getCorrectionCount();
  }

  // Corrections list
  if (args.show_corrections) {
    result.corrections = memory.getCorrections();
  }

  return JSON.stringify(result, null, 2);
}

async function handleListFreeeDeals(args: any): Promise<string> {
  const conn = getFreeeConnector();
  const deals = await conn.listDeals({
    type: args.type,
    start_issue_date: args.start_issue_date,
    end_issue_date: args.end_issue_date,
    limit: args.limit,
    offset: args.offset,
  });
  return JSON.stringify({
    ok: true,
    company_id: conn.companyId,
    company_name: conn.companyName,
    count: deals.length,
    deals: deals.map(d => ({
      id: d.id,
      date: d.issue_date,
      type: d.type,
      amount: d.amount,
      partner_id: d.partner_id,
      partner_name: d.partner_name,
      ref_number: d.ref_number,
      description: d.description,
      memo: d.memo,
      status: d.status,
    })),
  }, null, 2);
}

async function handleReconcileCrossSaas(args: any): Promise<string> {
  // MF connector is not yet implemented (= Phase 1.B). For now, return placeholder.
  return JSON.stringify({
    ok: false,
    error: 'NOT_IMPLEMENTED',
    todo: 'MF connector pending Phase 1.B. Current implementation will detect freee-internal duplicates only.',
  }, null, 2);
}

async function handleCheckDuplicate(args: any): Promise<string> {
  const conn = getFreeeConnector();
  // Fetch recent deals around the given date, then match by fingerprint
  const target = {
    date: args.date,
    amount: args.amount,
    memo: String(args.memo || '').slice(0, 40),
  };
  // Look ±7 days
  const dateObj = new Date(args.date);
  const startDate = new Date(dateObj.getTime() - 7 * 86400 * 1000).toISOString().slice(0, 10);
  const endDate = new Date(dateObj.getTime() + 7 * 86400 * 1000).toISOString().slice(0, 10);
  const deals = await conn.listDeals({ start_issue_date: startDate, end_issue_date: endDate, limit: 100 });
  const matches = deals.filter(d =>
    d.issue_date === target.date &&
    Math.abs(d.amount - target.amount) < 1 &&
    (d.memo || '').slice(0, 40) === target.memo
  );
  return JSON.stringify({
    ok: true,
    duplicate_found: matches.length > 0,
    match_count: matches.length,
    matches: matches.map(m => ({ id: m.id, date: m.issue_date, amount: m.amount })),
  }, null, 2);
}

async function handleUpsertPartner(args: any): Promise<string> {
  const conn = getFreeeConnector();
  const partners = await conn.listPartners({ limit: 100 });
  const target = String(args.partner_name || '').trim();
  const existing = partners.find(p => p.name === target);
  if (existing) {
    return JSON.stringify({
      ok: true,
      action: 'found_existing',
      partner_id: existing.id,
      partner_name: existing.name,
    }, null, 2);
  }
  // POST /partners not implemented yet (= write deferred to Phase 1.B)
  return JSON.stringify({
    ok: false,
    error: 'WRITE_NOT_IMPLEMENTED',
    todo: 'POST /partners write deferred to Phase 1.B. Currently read-only fuzzy match.',
    suggested_name: target,
  }, null, 2);
}

async function handleListFreeeCompanies(): Promise<string> {
  const conn = getFreeeConnector();
  const companies = await conn.listCompanies();
  return JSON.stringify({
    ok: true,
    count: companies.length,
    companies: companies.map(c => ({
      id: c.id,
      display_name: c.display_name,
      contact_name: c.contact_name,
      fiscal_yearmonth: c.fiscal_yearmonth,
    })),
  }, null, 2);
}

/**
 * Nightly batch pipeline for multi-company processing.
 *
 * Replaces the old single-company loop with the full NightlyPipeline:
 *   - Multi-company support (list_companies → parallel processing)
 *   - Unprocessed filter (status = 'unsettled')
 *   - Confidence routing (high/medium/low → auto/auto+log/human)
 *   - Business rule guards (100万超/新規取引先/月次決算期間)
 *   - Batch summary (Slack-ready format)
 */
async function handleNightlyRun(args: any): Promise<string> {
  const conn = getFreeeConnector();
  const pipeline = new NightlyPipeline(conn, classifier, exclusion, {
    dry_run: args.dry_run !== false, // default true
    company_ids: args.company_ids,
    concurrency: args.concurrency ?? 3,
    deals_per_company: args.deals_per_company ?? 100,
    period_start: args.period_start,
    period_end: args.period_end,
  }, memory);

  const result = await pipeline.run();

  // Return the full result but trim per-transaction details to keep response manageable.
  // Full review_queue and sample are included for each company.
  return JSON.stringify(result, null, 2);
}

// ============================================================
// MCP wiring
// ============================================================

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    let text: string;
    switch (name) {
      case 'classify_transaction': text = await handleClassifyTransaction(args); break;
      case 'check_exclusion': text = handleCheckExclusion(args); break;
      case 'import_csv': text = await handleImportCsv(args); break;
      case 'generate_monthly_report': text = await handleGenerateMonthlyReport(args); break;
      case 'list_freee_deals': text = await handleListFreeeDeals(args); break;
      case 'list_freee_companies': text = await handleListFreeeCompanies(); break;
      case 'reconcile_cross_saas': text = await handleReconcileCrossSaas(args); break;
      case 'check_duplicate': text = await handleCheckDuplicate(args); break;
      case 'upsert_partner': text = await handleUpsertPartner(args); break;
      case 'correct_classification': text = handleCorrectClassification(args); break;
      case 'recall_memory': text = handleRecallMemory(args); break;
      case 'nightly_run': text = await handleNightlyRun(args); break;
      default: throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text }] };
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err?.message ?? String(err) }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[@kansei-link/cockpit] MCP server ready on stdio (v${SERVER_VERSION})`);
console.error(`  Stage 1: ${keywordClassifier.getCategoriesCount()} categories, ${keywordClassifier.getKeywordsCount()} keywords (v${keywordClassifier.getVersion()})`);
console.error(`  Stage 2: ${claudeClassifier ? `enabled (${claudeClassifier.getModel()})` : 'disabled (set ANTHROPIC_API_KEY to enable)'}`);
console.error(`  Exclusion: ${exclusion.getRulesCount()} rules (v${exclusion.getVersion()})`);
console.error(`  Pipeline: Multi-company batch + confidence routing enabled`);
console.error(`  CSV Import: 弥生/freee/MF/generic auto-detect enabled`);
console.error(`  Reports: monthly review report generation enabled`);
console.error(`  Memory: ${memory.getPatternCount()} patterns, ${memory.getCorrectionCount()} corrections loaded`);
