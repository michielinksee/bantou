// CSV import orchestrator.
//
// Auto-detects CSV format (弥生/freee/MF/generic), parses rows,
// runs each through the full classification pipeline, and returns
// structured results grouped by routing action.

import { parseCsv } from './csv-parser.js';
import { YayoiAdapter } from './yayoi-adapter.js';
import { FreeeCsvAdapter } from './freee-csv-adapter.js';
import { GenericCsvAdapter } from './generic-adapter.js';
import {
  CsvSource,
  CsvAdapter,
  ColumnMapping,
  ClassifiedTransaction,
  ImportResult,
} from './types.js';
import { Transaction } from '../classifier/types.js';
import { TwoStageClassifier } from '../classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../pipeline/confidence-router.js';
import { CockpitMemory } from '../memory/cockpit-memory.js';
import { TaxRuleEngine } from '../tax-rules/tax-rule-engine.js';

/**
 * Import CSV and run through the full classification pipeline.
 *
 * @param csvText      - Raw CSV text (UTF-8).
 * @param classifier   - TwoStageClassifier instance.
 * @param exclusion    - ExclusionChecker instance.
 * @param router       - ConfidenceRouter instance.
 * @param opts.source  - Force a specific source format (skip auto-detection).
 * @param opts.mapping - Column mapping for generic CSV.
 */
export async function importCsv(
  csvText: string,
  classifier: TwoStageClassifier,
  exclusion: ExclusionChecker,
  router: ConfidenceRouter,
  opts: {
    source?: CsvSource;
    mapping?: ColumnMapping;
    memory?: CockpitMemory;
    taxRuleEngine?: TaxRuleEngine;
  } = {},
): Promise<ImportResult> {
  // 1. Parse CSV
  const { headers, rows } = parseCsv(csvText);

  if (headers.length === 0 || rows.length === 0) {
    return emptyResult('CSV is empty or has no data rows');
  }

  // 2. Detect or use specified adapter
  const adapter = resolveAdapter(headers, opts.source, opts.mapping);
  if (!adapter) {
    return emptyResult(
      `CSV format not recognized. Headers: [${headers.slice(0, 5).join(', ')}...]. ` +
      'Specify source="generic" with column mapping, or export from 弥生/freee in UTF-8.'
    );
  }

  // 3. Parse all rows
  const warnings: string[] = [];
  const parsed: { rowNumber: number; transaction: Transaction }[] = [];
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 1-based, +1 for header row
    const { transaction, skip_reason } = adapter.parseRow(rows[i], rowNumber);
    if (transaction) {
      parsed.push({ rowNumber, transaction });
    } else {
      skipped++;
      if (skip_reason && skipped <= 10) {
        warnings.push(`Row ${rowNumber}: ${skip_reason}`);
      }
    }
  }

  if (skipped > 10) {
    warnings.push(`... and ${skipped - 10} more skipped rows`);
  }

  if (parsed.length === 0) {
    return emptyResult('No valid transactions found in CSV', warnings);
  }

  // 4. Run each transaction through the pipeline
  const autoRegister: ClassifiedTransaction[] = [];
  const autoRegisterWithLog: ClassifiedTransaction[] = [];
  const humanReview: ClassifiedTransaction[] = [];
  const excludedTxns: ClassifiedTransaction[] = [];

  for (const { rowNumber, transaction } of parsed) {
    const ct = await classifyTransaction(
      rowNumber, transaction, classifier, exclusion, router, opts.memory, opts.taxRuleEngine,
    );

    switch (ct.action) {
      case 'auto_register':
        autoRegister.push(ct);
        break;
      case 'auto_register_with_log':
        autoRegisterWithLog.push(ct);
        break;
      case 'human_review':
        if (ct.excluded) {
          excludedTxns.push(ct);
        } else {
          humanReview.push(ct);
        }
        break;
    }
  }

  // 5. Build result
  const totalClassified = autoRegister.length + autoRegisterWithLog.length;
  const totalProcessed = parsed.length;
  const classificationRate = totalProcessed > 0
    ? ((totalClassified / totalProcessed) * 100).toFixed(1) + '%'
    : '0%';

  // Save memory after processing all rows
  if (opts.memory) {
    opts.memory.save();
  }

  const result: ImportResult = {
    ok: true,
    source: adapter.source,
    source_label: adapter.label,
    total_rows: rows.length,
    parsed_count: parsed.length,
    skipped_count: skipped,
    warnings,
    auto_register: autoRegister,
    auto_register_with_log: autoRegisterWithLog,
    human_review: humanReview,
    excluded: excludedTxns,
    summary: {
      auto_register_count: autoRegister.length,
      auto_register_with_log_count: autoRegisterWithLog.length,
      human_review_count: humanReview.length,
      excluded_count: excludedTxns.length,
      classification_rate: classificationRate,
    },
    csv_output: buildCsvOutput([...autoRegister, ...autoRegisterWithLog, ...humanReview, ...excludedTxns]),
    markdown_report: buildMarkdownReport(adapter, parsed.length, skipped, autoRegister, autoRegisterWithLog, humanReview, excludedTxns),
  };

  return result;
}

// ============================================================
// Internal helpers
// ============================================================

async function classifyTransaction(
  rowNumber: number,
  transaction: Transaction,
  classifier: TwoStageClassifier,
  exclusion: ExclusionChecker,
  router: ConfidenceRouter,
  memory?: CockpitMemory,
  taxRuleEngine?: TaxRuleEngine,
): Promise<ClassifiedTransaction> {
  // Stage 0: Exclusion
  const exc = exclusion.check(transaction);

  // Stage 1+2: Classification (only if not excluded)
  let cls = null;
  let memorySource: string | undefined;

  if (!exc.excluded) {
    // Memory recall before classification
    if (memory) {
      const recall = memory.recallPattern(transaction);

      if (recall.found && recall.source === 'correction' && recall.correction) {
        cls = {
          classified: true,
          category_id: recall.correction.to_category_id,
          category_name_ja: recall.correction.to_category_name_ja,
          freee_account_code: recall.correction.to_freee_account_code,
          tax_code: recall.correction.to_tax_code,
          confidence: 'high' as const,
          match_reason: recall.reason,
          classifier_version: 'memory-correction',
        };
        memorySource = 'correction';
      } else if (recall.found && recall.source === 'pattern' && recall.pattern) {
        cls = {
          classified: true,
          category_id: recall.pattern.category_id,
          category_name_ja: recall.pattern.category_name_ja,
          freee_account_code: recall.pattern.freee_account_code,
          tax_code: recall.pattern.tax_code,
          confidence: recall.confidence,
          match_reason: recall.reason,
          classifier_version: 'memory-pattern',
        };
        memorySource = 'pattern';
      }
    }

    // Fall through to normal classification if memory miss
    if (!cls) {
      cls = await classifier.classify(transaction);
    }
  }

  // Routing
  const routing = router.route(exc, cls, {
    amount: transaction.amount,
    partner_name: transaction.partner_name,
    is_new_partner: false, // CSV import = no partner DB to check
    date: transaction.date,
  });

  // Remember classification for future recall (only successful auto-classifications)
  if (memory && !memorySource && cls?.classified && (routing.action === 'auto_register' || routing.action === 'auto_register_with_log')) {
    memory.rememberClassification(
      transaction,
      cls.category_id!,
      cls.category_name_ja!,
      cls.confidence,
      'keyword', // CSV import is always Stage 1 in practice
      cls.freee_account_code,
      typeof cls.tax_code === 'number' ? cls.tax_code : undefined,
    );
  }

  // Tax Rule Engine: post-classification refinements
  let taxCodeOverride: number | undefined;
  let taxCodeReason: string | undefined;
  let assetTier: string | undefined;
  let assetWarning: string | undefined;
  let withholdingAmount: number | undefined;
  let withholdingRate: string | undefined;
  let consumptionTaxRate: number | undefined;
  let consumptionTaxReason: string | undefined;
  let taxRuleWarnings: string[] | undefined;

  if (taxRuleEngine && cls?.classified) {
    const taxResult = taxRuleEngine.applyRules(transaction, cls);

    if (taxResult.tax_code_override !== undefined) {
      taxCodeOverride = taxResult.tax_code_override;
      taxCodeReason = taxResult.tax_code_reason;
    }
    if (taxResult.asset_tier && taxResult.asset_tier !== 'expense') {
      assetTier = taxResult.asset_tier;
      assetWarning = taxResult.asset_warning;
    }
    if (taxResult.withholding) {
      withholdingAmount = taxResult.withholding.withholding_amount;
      withholdingRate = taxResult.withholding.rate_description;
    }
    if (taxResult.consumption_tax_rate !== undefined) {
      consumptionTaxRate = taxResult.consumption_tax_rate;
      consumptionTaxReason = taxResult.consumption_tax_reason;
    }
    if (taxResult.warnings.length > 0) {
      taxRuleWarnings = taxResult.warnings;
    }
  }

  return {
    row_number: rowNumber,
    transaction,
    excluded: exc.excluded,
    exclusion_rule: exc.rule_id,
    exclusion_reason: exc.reason,
    classified: cls?.classified ?? false,
    category_id: cls?.category_id,
    category_name_ja: cls?.category_name_ja,
    confidence: cls?.confidence,
    matched_keyword: cls?.matched_keyword,
    stage: cls?.stage as number | undefined,
    freee_account_code: cls?.freee_account_code,
    tax_code: taxCodeOverride ?? cls?.tax_code,
    tax_code_override: taxCodeOverride,
    tax_code_reason: taxCodeReason,
    asset_tier: assetTier,
    asset_warning: assetWarning,
    withholding_amount: withholdingAmount,
    withholding_rate: withholdingRate,
    consumption_tax_rate: consumptionTaxRate,
    consumption_tax_reason: consumptionTaxReason,
    tax_rule_warnings: taxRuleWarnings,
    action: routing.action,
    routing_flags: routing.flags,
    routing_reasons: routing.reasons,
  };
}

function resolveAdapter(
  headers: string[],
  source?: CsvSource,
  mapping?: ColumnMapping,
): CsvAdapter | null {
  // If source is explicitly specified
  if (source === 'yayoi') {
    const a = new YayoiAdapter();
    a.detectFormat(headers);
    return a;
  }
  if (source === 'freee_export') {
    const a = new FreeeCsvAdapter();
    a.detectFormat(headers);
    return a;
  }
  if (source === 'generic' && mapping) {
    return new GenericCsvAdapter(mapping);
  }

  // Auto-detect: try each adapter in priority order
  const adapters: CsvAdapter[] = [
    new YayoiAdapter(),
    new FreeeCsvAdapter(),
  ];

  for (const adapter of adapters) {
    if (adapter.detectFormat(headers)) {
      return adapter;
    }
  }

  // Fallback: if mapping provided, use generic
  if (mapping) {
    return new GenericCsvAdapter(mapping);
  }

  return null;
}

function emptyResult(error: string, warnings: string[] = []): ImportResult {
  return {
    ok: false,
    source: 'generic',
    source_label: 'Unknown',
    total_rows: 0,
    parsed_count: 0,
    skipped_count: 0,
    warnings: [error, ...warnings],
    auto_register: [],
    auto_register_with_log: [],
    human_review: [],
    excluded: [],
    summary: {
      auto_register_count: 0,
      auto_register_with_log_count: 0,
      human_review_count: 0,
      excluded_count: 0,
      classification_rate: '0%',
    },
  };
}

/**
 * Build a CSV output with classification results appended as new columns.
 * Can be re-imported into 弥生 or used for review.
 */
function buildCsvOutput(transactions: ClassifiedTransaction[]): string {
  const headers = [
    '行番号', '日付', '金額', '摘要', '取引先',
    '分類結果', '勘定科目', '信頼度', 'アクション', 'フラグ',
  ];
  const lines = [headers.join(',')];

  for (const ct of transactions) {
    const cols = [
      String(ct.row_number),
      ct.transaction.date,
      String(ct.transaction.amount),
      csvEscape(ct.transaction.memo),
      csvEscape(ct.transaction.partner_name || ''),
      csvEscape(ct.category_name_ja || (ct.excluded ? `除外: ${ct.exclusion_rule}` : '未分類')),
      ct.freee_account_code ? String(ct.freee_account_code) : '',
      ct.confidence || '',
      ct.action,
      ct.routing_flags.join(';'),
    ];
    lines.push(cols.join(','));
  }

  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/**
 * Build a Markdown report summarizing the import results.
 */
function buildMarkdownReport(
  adapter: CsvAdapter,
  parsedCount: number,
  skippedCount: number,
  autoRegister: ClassifiedTransaction[],
  autoRegisterWithLog: ClassifiedTransaction[],
  humanReview: ClassifiedTransaction[],
  excluded: ClassifiedTransaction[],
): string {
  const total = parsedCount;
  const autoCount = autoRegister.length;
  const autoLogCount = autoRegisterWithLog.length;
  const reviewCount = humanReview.length;
  const excludedCount = excluded.length;
  const classRate = total > 0
    ? (((autoCount + autoLogCount) / total) * 100).toFixed(1)
    : '0';

  let md = `# CSV Import Report\n\n`;
  md += `**Source**: ${adapter.label}\n`;
  md += `**Date**: ${new Date().toISOString().slice(0, 10)}\n\n`;

  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total rows | ${total + skippedCount} |\n`;
  md += `| Parsed | ${total} |\n`;
  md += `| Skipped | ${skippedCount} |\n`;
  md += `| Auto-register (high confidence) | ${autoCount} |\n`;
  md += `| Auto-register with log (medium) | ${autoLogCount} |\n`;
  md += `| Human review required | ${reviewCount} |\n`;
  md += `| Excluded (Stage 0) | ${excludedCount} |\n`;
  md += `| **Classification rate** | **${classRate}%** |\n\n`;

  // Category breakdown
  const categoryMap = new Map<string, { count: number; total: number }>();
  for (const ct of [...autoRegister, ...autoRegisterWithLog]) {
    const cat = ct.category_name_ja || '不明';
    const existing = categoryMap.get(cat) || { count: 0, total: 0 };
    existing.count++;
    existing.total += ct.transaction.amount;
    categoryMap.set(cat, existing);
  }

  if (categoryMap.size > 0) {
    md += `## Category Breakdown\n\n`;
    md += `| Category | Count | Total Amount |\n|---|---|---|\n`;
    const sorted = [...categoryMap.entries()].sort((a, b) => b[1].total - a[1].total);
    for (const [cat, { count, total }] of sorted) {
      md += `| ${cat} | ${count} | ¥${total.toLocaleString()} |\n`;
    }
    md += '\n';
  }

  // Human review items
  if (humanReview.length > 0) {
    md += `## Human Review Required (${reviewCount} items)\n\n`;
    md += `| Row | Date | Amount | Memo | Reason |\n|---|---|---|---|---|\n`;
    for (const ct of humanReview.slice(0, 20)) {
      const reasons = ct.routing_flags.join(', ') || ct.routing_reasons[0] || '';
      md += `| ${ct.row_number} | ${ct.transaction.date} | ¥${ct.transaction.amount.toLocaleString()} | ${ct.transaction.memo.slice(0, 30)} | ${reasons} |\n`;
    }
    if (humanReview.length > 20) {
      md += `| ... | ... | ... | ... | +${humanReview.length - 20} more |\n`;
    }
    md += '\n';
  }

  // Excluded items
  if (excluded.length > 0) {
    md += `## Excluded Transactions (${excludedCount} items)\n\n`;
    md += `| Row | Date | Amount | Memo | Rule |\n|---|---|---|---|---|\n`;
    for (const ct of excluded.slice(0, 10)) {
      md += `| ${ct.row_number} | ${ct.transaction.date} | ¥${ct.transaction.amount.toLocaleString()} | ${ct.transaction.memo.slice(0, 30)} | ${ct.exclusion_rule || ''} |\n`;
    }
    if (excluded.length > 10) {
      md += `| ... | ... | ... | ... | +${excluded.length - 10} more |\n`;
    }
    md += '\n';
  }

  return md;
}
