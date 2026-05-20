// Monthly review report generator.
//
// Takes classified transaction data and produces a practitioner-proven
// monthly review report in Markdown format.
//
// Features:
//   - Category-wise expense breakdown with monthly/yearly comparison
//   - Anomaly detection (significant deviations from expected patterns)
//   - Action items (transactions requiring human review)
//   - Summary KPIs (total expense, income, classification rate)

import { Transaction } from '../classifier/types.js';
import { TwoStageClassifier } from '../classifier/two-stage-classifier.js';
import { ExclusionChecker } from '../exclusion/exclusion-checker.js';
import { ConfidenceRouter } from '../pipeline/confidence-router.js';

/** Processed transaction with classification for reporting. */
interface ReportTransaction {
  transaction: Transaction;
  category_id?: string;
  category_name_ja?: string;
  confidence?: string;
  excluded: boolean;
  exclusion_rule?: string;
  action: string;
  flags: string[];
}

/** Category aggregate for the report. */
interface CategoryAggregate {
  category_id: string;
  category_name_ja: string;
  count: number;
  total_amount: number;
  transactions: ReportTransaction[];
}

/** Anomaly detected in the data. */
interface Anomaly {
  type: 'high_amount' | 'unusual_category' | 'new_partner' | 'frequency_spike';
  severity: 'warning' | 'critical';
  description: string;
  details: string;
}

/** Monthly report output. */
export interface MonthlyReportResult {
  ok: boolean;
  company_name?: string;
  month: string;
  format: 'markdown' | 'json';

  // KPIs
  total_transactions: number;
  total_expense: number;
  total_income: number;
  classification_rate: string;
  auto_register_rate: string;

  // Aggregates
  categories: CategoryAggregate[];
  anomalies: Anomaly[];
  review_items: ReportTransaction[];

  // Formatted output
  markdown?: string;
}

/**
 * Generate a monthly report from raw transactions.
 *
 * @param transactions - Array of raw transactions (from freee API, CSV import, etc.)
 * @param classifier   - TwoStageClassifier instance.
 * @param exclusion    - ExclusionChecker instance.
 * @param router       - ConfidenceRouter instance.
 * @param opts         - Report options.
 */
export async function generateMonthlyReport(
  transactions: Transaction[],
  classifier: TwoStageClassifier,
  exclusion: ExclusionChecker,
  router: ConfidenceRouter,
  opts: {
    company_name?: string;
    month: string; // YYYY-MM
    compare_transactions?: Transaction[]; // Previous month or year for comparison
    compare_label?: string; // "前月" or "前年同月"
    format?: 'markdown' | 'json';
  },
): Promise<MonthlyReportResult> {
  const format = opts.format || 'markdown';

  // 1. Classify all transactions
  const processed: ReportTransaction[] = [];
  let totalExpense = 0;
  let totalIncome = 0;
  let autoCount = 0;

  for (const tx of transactions) {
    const exc = exclusion.check(tx);
    let cls = null;
    if (!exc.excluded) {
      cls = await classifier.classify(tx);
    }
    const routing = router.route(exc, cls, {
      amount: tx.amount,
      partner_name: tx.partner_name,
      is_new_partner: false,
      date: tx.date,
    });

    const rt: ReportTransaction = {
      transaction: tx,
      category_id: cls?.category_id,
      category_name_ja: cls?.category_name_ja,
      confidence: cls?.confidence,
      excluded: exc.excluded,
      exclusion_rule: exc.rule_id,
      action: routing.action,
      flags: routing.flags,
    };
    processed.push(rt);

    // Accumulate totals (rough heuristic: negative = income, positive = expense)
    totalExpense += tx.amount;

    if (routing.action === 'auto_register' || routing.action === 'auto_register_with_log') {
      autoCount++;
    }
  }

  // 2. Build category aggregates
  const catMap = new Map<string, CategoryAggregate>();
  for (const rt of processed) {
    if (rt.excluded) continue;
    const catId = rt.category_id || '_unclassified';
    const catName = rt.category_name_ja || '未分類';
    if (!catMap.has(catId)) {
      catMap.set(catId, {
        category_id: catId,
        category_name_ja: catName,
        count: 0,
        total_amount: 0,
        transactions: [],
      });
    }
    const agg = catMap.get(catId)!;
    agg.count++;
    agg.total_amount += rt.transaction.amount;
    agg.transactions.push(rt);
  }
  const categories = [...catMap.values()].sort((a, b) => b.total_amount - a.total_amount);

  // 3. Detect anomalies
  const anomalies = detectAnomalies(processed, categories);

  // 4. Build comparison data (if provided)
  let comparisonCategories: Map<string, number> | undefined;
  if (opts.compare_transactions && opts.compare_transactions.length > 0) {
    comparisonCategories = new Map();
    for (const tx of opts.compare_transactions) {
      const cls = await classifier.classify(tx);
      const catId = cls?.category_id || '_unclassified';
      comparisonCategories.set(catId, (comparisonCategories.get(catId) || 0) + tx.amount);
    }
  }

  // 5. Review items
  const reviewItems = processed.filter(rt => rt.action === 'human_review');

  // 6. Rates
  const total = processed.length;
  const classifiedCount = processed.filter(rt => rt.category_id && !rt.excluded).length;
  const classificationRate = total > 0 ? ((classifiedCount / total) * 100).toFixed(1) + '%' : '0%';
  const autoRegisterRate = total > 0 ? ((autoCount / total) * 100).toFixed(1) + '%' : '0%';

  // 7. Build markdown
  let markdown: string | undefined;
  if (format === 'markdown') {
    markdown = buildMarkdown(
      opts.company_name || '(Company)',
      opts.month,
      total,
      totalExpense,
      totalIncome,
      classificationRate,
      autoRegisterRate,
      categories,
      anomalies,
      reviewItems,
      comparisonCategories,
      opts.compare_label,
    );
  }

  return {
    ok: true,
    company_name: opts.company_name,
    month: opts.month,
    format,
    total_transactions: total,
    total_expense: totalExpense,
    total_income: totalIncome,
    classification_rate: classificationRate,
    auto_register_rate: autoRegisterRate,
    categories,
    anomalies,
    review_items: reviewItems,
    markdown,
  };
}

// ============================================================
// Anomaly detection
// ============================================================

function detectAnomalies(
  transactions: ReportTransaction[],
  categories: CategoryAggregate[],
): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // Rule 1: Single transactions > ¥500K
  for (const rt of transactions) {
    if (rt.transaction.amount > 500_000 && !rt.excluded) {
      anomalies.push({
        type: 'high_amount',
        severity: rt.transaction.amount > 1_000_000 ? 'critical' : 'warning',
        description: `高額取引: ¥${rt.transaction.amount.toLocaleString()}`,
        details: `${rt.transaction.date} ${rt.transaction.memo}`,
      });
    }
  }

  // Rule 2: 交際費 (entertainment) > ¥100K total — flag for 5,000円基準 review
  const entertainment = categories.find(c => c.category_id === 'entertainment');
  if (entertainment && entertainment.total_amount > 100_000) {
    anomalies.push({
      type: 'unusual_category',
      severity: 'warning',
      description: `交際費合計 ¥${entertainment.total_amount.toLocaleString()} — 5,000円基準/損金算入限度 確認推奨`,
      details: `${entertainment.count}件の交際費取引`,
    });
  }

  // Rule 3: Unclassified transactions > 10%
  const unclassified = categories.find(c => c.category_id === '_unclassified');
  if (unclassified) {
    const total = transactions.filter(t => !t.excluded).length;
    const ratio = total > 0 ? unclassified.count / total : 0;
    if (ratio > 0.1) {
      anomalies.push({
        type: 'unusual_category',
        severity: 'warning',
        description: `未分類率 ${(ratio * 100).toFixed(1)}% — キーワード辞書の拡充推奨`,
        details: `${unclassified.count}/${total} 件が未分類`,
      });
    }
  }

  return anomalies;
}

// ============================================================
// Markdown builder
// ============================================================

function buildMarkdown(
  companyName: string,
  month: string,
  total: number,
  totalExpense: number,
  totalIncome: number,
  classificationRate: string,
  autoRegisterRate: string,
  categories: CategoryAggregate[],
  anomalies: Anomaly[],
  reviewItems: ReportTransaction[],
  comparisonCategories?: Map<string, number>,
  compareLabel?: string,
): string {
  const [year, mon] = month.split('-');
  const title = `${companyName} — ${year}年${parseInt(mon)}月 月次レビューレポート`;

  let md = `# ${title}\n\n`;
  md += `> Generated: ${new Date().toISOString().slice(0, 10)} by Cockpit MCP\n\n`;

  // ── Summary ──
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Total transactions | ${total} |\n`;
  md += `| Total expense | ¥${totalExpense.toLocaleString()} |\n`;
  md += `| Classification rate | ${classificationRate} |\n`;
  md += `| Auto-register rate | ${autoRegisterRate} |\n`;
  md += `| Review required | ${reviewItems.length} |\n`;
  md += `| Anomalies detected | ${anomalies.length} |\n\n`;

  // ── Anomalies ──
  if (anomalies.length > 0) {
    md += `## Anomalies\n\n`;
    for (const a of anomalies) {
      const icon = a.severity === 'critical' ? '[CRITICAL]' : '[WARNING]';
      md += `- ${icon} **${a.description}**\n`;
      md += `  ${a.details}\n`;
    }
    md += '\n';
  }

  // ── Category Breakdown ──
  md += `## Category Breakdown\n\n`;
  if (comparisonCategories && compareLabel) {
    md += `| Category | Count | Amount | ${compareLabel} | Change |\n|---|---|---|---|---|\n`;
    for (const cat of categories) {
      const prevAmount = comparisonCategories.get(cat.category_id) || 0;
      const change = prevAmount > 0
        ? ((cat.total_amount - prevAmount) / prevAmount * 100).toFixed(1) + '%'
        : 'NEW';
      const changeSign = cat.total_amount > prevAmount ? '+' : '';
      md += `| ${cat.category_name_ja} | ${cat.count} | ¥${cat.total_amount.toLocaleString()} | ¥${prevAmount.toLocaleString()} | ${changeSign}${change} |\n`;
    }
  } else {
    md += `| Category | Count | Amount | Share |\n|---|---|---|---|\n`;
    for (const cat of categories) {
      const share = totalExpense > 0
        ? ((cat.total_amount / totalExpense) * 100).toFixed(1) + '%'
        : '0%';
      md += `| ${cat.category_name_ja} | ${cat.count} | ¥${cat.total_amount.toLocaleString()} | ${share} |\n`;
    }
  }
  md += '\n';

  // ── Review Items ──
  if (reviewItems.length > 0) {
    md += `## Review Required (${reviewItems.length} items)\n\n`;
    md += `| Date | Amount | Memo | Reason |\n|---|---|---|---|\n`;
    for (const rt of reviewItems.slice(0, 30)) {
      const reason = rt.flags.length > 0
        ? rt.flags.join(', ')
        : (rt.excluded ? `Excluded: ${rt.exclusion_rule}` : 'Low confidence');
      md += `| ${rt.transaction.date} | ¥${rt.transaction.amount.toLocaleString()} | ${rt.transaction.memo.slice(0, 35)} | ${reason} |\n`;
    }
    if (reviewItems.length > 30) {
      md += `| ... | ... | ... | +${reviewItems.length - 30} more |\n`;
    }
    md += '\n';
  }

  // ── Footer ──
  md += `---\n\n`;
  md += `*Generated by @kansei-link/cockpit MCP — automated monthly review*\n`;

  return md;
}
