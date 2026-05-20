// Cockpit Memory — persistent classification pattern store.
//
// Implements the "判断の境界線" pattern:
//   "過去 3 ヶ月以内に同じ取引先 + 同じ金額 ±5% で同じ category → AI 自動 OK"
//   "新規 → 確認"
//   "修正 → 次回以降は修正後の分類を使う"
//
// Storage: JSON file at ~/.cockpit-mcp/memory.json (configurable).
// Data model mirrors Linksee's 6-layer model:
//   implementation → classification patterns
//   caveat         → corrections (never forgotten)
//   context        → company-specific configs
//
// Thread safety: Node.js single-threaded + sequential deal processing = safe.
// Save strategy: caller invokes save() after each company batch.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { normalizeMemo } from '../classifier/normalize.js';
import { Transaction } from '../classifier/types.js';
import {
  MemoryStore,
  MemoryStats,
  ClassificationPattern,
  CorrectionRecord,
  CompanyMemoryConfig,
  PatternRecallResult,
  CorrectionInput,
} from './types.js';

// ============================================================
// Constants
// ============================================================

const DEFAULT_STORE_DIR = join(homedir(), '.cockpit-mcp');
const DEFAULT_STORE_PATH = join(DEFAULT_STORE_DIR, 'memory.json');
const STORE_VERSION = '1.0.0';

/** Practitioner rule: patterns older than 3 months are stale */
const PATTERN_RECENCY_MONTHS = 3;

/** Practitioner rule: ±5% amount tolerance */
const AMOUNT_TOLERANCE = 0.05;

/** Minimum keyword overlap for memo-based matching */
const MIN_KEYWORD_OVERLAP = 2;

// ============================================================
// CockpitMemory
// ============================================================

export class CockpitMemory {
  private store: MemoryStore;
  private storePath: string;
  private dirty: boolean = false;

  constructor(storePath?: string) {
    this.storePath = storePath || DEFAULT_STORE_PATH;
    this.store = this.loadStore();
  }

  // ──────────────────────────────────────────────────────────
  // Recall operations
  // ──────────────────────────────────────────────────────────

  /**
   * Recall a past classification pattern for a transaction.
   *
   * Priority: corrections (caveat) > patterns (implementation).
   * Rule: "過去パターン一致 → AI 処理 OK"
   */
  recallPattern(tx: Transaction): PatternRecallResult {
    const partnerKey = makePartnerKey(tx.partner_name, tx.memo);

    // 1. Check corrections first (caveat layer = never forgotten)
    const correction = this.findCorrection(partnerKey, tx.memo, tx.company_id);
    if (correction) {
      this.store.stats.correction_hits++;
      this.dirty = true;
      return {
        found: true,
        correction,
        source: 'correction',
        confidence: 'high', // corrections are always high confidence
        reason: `修正パターン一致: "${correction.memo_pattern}" → ${correction.to_category_name_ja} (理由: ${correction.reason})`,
      };
    }

    // 2. Check patterns (implementation layer)
    const pattern = this.findPattern(partnerKey, tx.amount, tx.memo, tx.company_id);
    if (pattern) {
      this.store.stats.pattern_hits++;
      this.dirty = true;
      return {
        found: true,
        pattern,
        source: 'pattern',
        confidence: pattern.match_count >= 3 ? 'high' : 'medium',
        reason: `過去パターン一致: "${pattern.partner_key}" × ${pattern.match_count}回 → ${pattern.category_name_ja}`,
      };
    }

    // 3. No match
    this.store.stats.cache_misses++;
    this.dirty = true;
    return {
      found: false,
      source: 'none',
      confidence: 'low',
      reason: '過去パターンなし — 通常分類フローへ',
    };
  }

  /**
   * Recall company-specific routing config.
   */
  recallCompanyConfig(companyId: number): CompanyMemoryConfig | null {
    return this.store.company_configs[companyId] || null;
  }

  // ──────────────────────────────────────────────────────────
  // Remember operations
  // ──────────────────────────────────────────────────────────

  /**
   * Remember a classification result for future pattern matching.
   * Called after successful classification (auto_register or auto_register_with_log).
   */
  rememberClassification(
    tx: Transaction,
    categoryId: string,
    categoryNameJa: string,
    confidence: string,
    source: 'keyword' | 'claude',
    freeeAccountCode?: number,
    taxCode?: number,
  ): void {
    const partnerKey = makePartnerKey(tx.partner_name, tx.memo);
    const memoKeywords = extractKeywords(tx.memo);

    // Look for existing pattern with same partner_key + category_id
    const existing = this.findExactPattern(partnerKey, categoryId);

    if (existing) {
      // Update existing pattern
      existing.match_count++;
      existing.last_seen = new Date().toISOString().slice(0, 10);
      existing.amount_typical = rollingAverage(
        existing.amount_typical, tx.amount, existing.match_count
      );
      if (tx.company_id && !existing.company_ids.includes(tx.company_id)) {
        existing.company_ids.push(tx.company_id);
      }
      // Merge keywords
      for (const kw of memoKeywords) {
        if (!existing.memo_keywords.includes(kw)) {
          existing.memo_keywords.push(kw);
        }
      }
    } else {
      // Create new pattern
      const pattern: ClassificationPattern = {
        partner_key: partnerKey,
        partner_name: tx.partner_name,
        memo_sample: tx.memo,
        memo_keywords: memoKeywords,
        category_id: categoryId,
        category_name_ja: categoryNameJa,
        freee_account_code: freeeAccountCode,
        tax_code: taxCode,
        amount_typical: tx.amount,
        confidence_source: source,
        match_count: 1,
        first_seen: new Date().toISOString().slice(0, 10),
        last_seen: new Date().toISOString().slice(0, 10),
        company_ids: tx.company_id ? [tx.company_id] : [],
      };

      if (!this.store.patterns[partnerKey]) {
        this.store.patterns[partnerKey] = [];
      }
      this.store.patterns[partnerKey].push(pattern);
      this.store.stats.total_patterns++;
    }

    this.dirty = true;
  }

  /**
   * Remember a tax accountant correction (caveat layer = never forgotten).
   * Corrections override future pattern matches.
   */
  rememberCorrection(input: CorrectionInput): CorrectionRecord {
    const partnerKey = makePartnerKey(input.partner_name, input.memo_pattern);
    const id = `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record: CorrectionRecord = {
      id,
      partner_key: partnerKey,
      memo_pattern: input.memo_pattern,
      from_category_id: input.from_category_id,
      from_category_name_ja: input.from_category_name_ja,
      to_category_id: input.to_category_id,
      to_category_name_ja: input.to_category_name_ja,
      to_freee_account_code: input.to_freee_account_code,
      to_tax_code: input.to_tax_code,
      reason: input.reason,
      corrected_at: new Date().toISOString(),
      company_id: input.company_id,
      active: true,
    };

    this.store.corrections.push(record);
    this.store.stats.total_corrections++;
    this.dirty = true;

    // Also update/create a pattern with correction source so pattern recall
    // picks it up for amount matching
    if (!this.store.patterns[partnerKey]) {
      this.store.patterns[partnerKey] = [];
    }
    // Check if we already have a pattern for the corrected category
    const existingCorrPattern = this.store.patterns[partnerKey]
      .find(p => p.category_id === input.to_category_id && p.confidence_source === 'correction');
    if (!existingCorrPattern) {
      this.store.patterns[partnerKey].push({
        partner_key: partnerKey,
        partner_name: input.partner_name,
        memo_sample: input.memo_pattern,
        memo_keywords: extractKeywords(input.memo_pattern),
        category_id: input.to_category_id,
        category_name_ja: input.to_category_name_ja,
        freee_account_code: input.to_freee_account_code,
        tax_code: input.to_tax_code,
        amount_typical: 0, // will be updated on first match
        confidence_source: 'correction',
        match_count: 1,
        first_seen: new Date().toISOString().slice(0, 10),
        last_seen: new Date().toISOString().slice(0, 10),
        company_ids: input.company_id ? [input.company_id] : [],
      });
      this.store.stats.total_patterns++;
    }

    return record;
  }

  /**
   * Set company-specific routing configuration (context layer).
   */
  setCompanyConfig(config: CompanyMemoryConfig): void {
    this.store.company_configs[config.company_id] = {
      ...config,
      updated_at: new Date().toISOString(),
    };
    this.dirty = true;
  }

  // ──────────────────────────────────────────────────────────
  // Persistence
  // ──────────────────────────────────────────────────────────

  /** Flush dirty store to disk. Call after each company batch. */
  save(): void {
    if (!this.dirty) return;
    this.store.updated_at = new Date().toISOString();
    this.store.stats.last_save = this.store.updated_at;

    const dir = dirname(this.storePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
    this.dirty = false;
  }

  /** Get current stats. */
  getStats(): MemoryStats {
    return { ...this.store.stats };
  }

  /** Get total pattern count. */
  getPatternCount(): number {
    return this.store.stats.total_patterns;
  }

  /** Get total correction count. */
  getCorrectionCount(): number {
    return this.store.stats.total_corrections;
  }

  /** Get all corrections (for display/export). */
  getCorrections(): CorrectionRecord[] {
    return this.store.corrections.filter(c => c.active);
  }

  /** Get all patterns for a partner key (for display/export). */
  getPatterns(partnerKey?: string): ClassificationPattern[] {
    if (partnerKey) {
      return this.store.patterns[partnerKey] || [];
    }
    return Object.values(this.store.patterns).flat();
  }

  // ──────────────────────────────────────────────────────────
  // Internal: pattern matching
  // ──────────────────────────────────────────────────────────

  private findCorrection(
    partnerKey: string,
    memo: string,
    companyId?: number,
  ): CorrectionRecord | null {
    const normalizedMemo = normalizeMemo(memo);

    // Search corrections in reverse chronological order (newest first)
    for (let i = this.store.corrections.length - 1; i >= 0; i--) {
      const corr = this.store.corrections[i];
      if (!corr.active) continue;

      // Company filter: correction applies if company_id matches or is null (= global)
      if (corr.company_id && companyId && corr.company_id !== companyId) continue;

      // Match by partner_key OR memo_pattern.
      // Corrections are the caveat layer — must match broadly to prevent repeat errors.
      // Partner key match (exact or prefix — correction key may be shorter)
      const keyMatch = corr.partner_key === partnerKey
        || partnerKey.startsWith(corr.partner_key + '_')
        || corr.partner_key.startsWith(partnerKey + '_');

      // Memo pattern match (substring in either direction)
      const normalizedPattern = normalizeMemo(corr.memo_pattern);
      const memoMatch = normalizedPattern.length >= 2
        && (normalizedMemo.includes(normalizedPattern) || normalizedPattern.includes(normalizedMemo));

      if (keyMatch || memoMatch) {
        return corr;
      }
    }

    return null;
  }

  private findPattern(
    partnerKey: string,
    amount: number,
    memo: string,
    companyId?: number,
  ): ClassificationPattern | null {
    // 1. Direct partner_key lookup
    const candidates = this.store.patterns[partnerKey];
    if (candidates && candidates.length > 0) {
      const match = this.bestPatternMatch(candidates, amount, companyId);
      if (match) return match;
    }

    // 2. Memo keyword fallback (when partner_key didn't match directly)
    const memoKeywords = extractKeywords(memo);
    if (memoKeywords.length < MIN_KEYWORD_OVERLAP) return null;

    for (const [key, patterns] of Object.entries(this.store.patterns)) {
      if (key === partnerKey) continue; // already checked
      for (const p of patterns) {
        const overlap = countKeywordOverlap(memoKeywords, p.memo_keywords);
        if (overlap >= MIN_KEYWORD_OVERLAP && isRecent(p.last_seen)) {
          // Also check amount range for keyword-based matches
          if (p.amount_typical > 0 && amountInRange(amount, p.amount_typical)) {
            return p;
          }
        }
      }
    }

    return null;
  }

  private bestPatternMatch(
    candidates: ClassificationPattern[],
    amount: number,
    companyId?: number,
  ): ClassificationPattern | null {
    let best: ClassificationPattern | null = null;
    let bestScore = -1;

    for (const p of candidates) {
      // Recency check
      if (!isRecent(p.last_seen)) continue;

      // Amount range check (skip if amount_typical is 0 = correction placeholder)
      if (p.amount_typical > 0 && !amountInRange(amount, p.amount_typical)) continue;

      // Company filter: if pattern is a company-specific correction and query
      // company doesn't match, skip it (correction for different company)
      if (p.confidence_source === 'correction'
        && p.company_ids.length > 0
        && companyId
        && !p.company_ids.includes(companyId)) {
        continue;
      }

      // Score: correction source > match_count > recency
      let score = p.match_count;
      if (p.confidence_source === 'correction') score += 1000; // corrections always win
      if (companyId && p.company_ids.includes(companyId)) score += 100; // company-specific bonus

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best;
  }

  private findExactPattern(
    partnerKey: string,
    categoryId: string,
  ): ClassificationPattern | null {
    const patterns = this.store.patterns[partnerKey];
    if (!patterns) return null;
    return patterns.find(p => p.category_id === categoryId) || null;
  }

  // ──────────────────────────────────────────────────────────
  // Internal: persistence
  // ──────────────────────────────────────────────────────────

  private loadStore(): MemoryStore {
    try {
      if (existsSync(this.storePath)) {
        const raw = readFileSync(this.storePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // Validate version
        if (parsed.version === STORE_VERSION) {
          return parsed;
        }
        // Version mismatch — migrate or start fresh
        console.error(`[cockpit-memory] Store version mismatch: ${parsed.version} vs ${STORE_VERSION}, starting fresh`);
      }
    } catch (err) {
      console.error(`[cockpit-memory] Failed to load store: ${err}`);
    }

    return emptyStore();
  }
}

// ============================================================
// Pure helper functions
// ============================================================

function emptyStore(): MemoryStore {
  return {
    version: STORE_VERSION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    patterns: {},
    corrections: [],
    company_configs: {},
    stats: {
      total_patterns: 0,
      total_corrections: 0,
      pattern_hits: 0,
      correction_hits: 0,
      cache_misses: 0,
      last_save: '',
    },
  };
}

/**
 * Create a normalized lookup key from partner name or memo.
 *
 * Priority: partner_name (if non-empty) → first 3 significant memo keywords.
 * Uses the same normalization as the keyword classifier for consistency.
 */
export function makePartnerKey(partnerName?: string, memo?: string): string {
  if (partnerName && partnerName.trim()) {
    let key = normalizeMemo(partnerName.trim());
    // Remove common suffixes (株式会社, (株), 有限会社 etc.)
    key = key
      .replace(/[（(]株[）)]/g, '')
      .replace(/株式会社/g, '')
      .replace(/有限会社/g, '')
      .replace(/合同会社/g, '')
      .trim();
    return key || '_unknown';
  }

  // Fallback: extract significant keywords from memo
  const keywords = extractKeywords(memo || '');
  if (keywords.length > 0) {
    return keywords.slice(0, 3).join('_');
  }

  return '_unknown';
}

/**
 * Extract significant keywords from a memo string.
 * Splits on whitespace/punctuation, normalizes, removes short words.
 */
export function extractKeywords(memo: string): string[] {
  const normalized = normalizeMemo(memo);
  return normalized
    .split(/[\s・\/\-_,、。]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2)
    .filter(w => !STOP_WORDS.has(w));
}

/** Common words that don't help with matching. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'this', 'that',
  'から', 'まで', 'への', 'です', 'ます', 'した', 'する',
  '分', '月', '月分', '件', '回',
]);

/**
 * Check if amount is within ±tolerance of typical amount.
 * Practitioner rule: ±5%.
 */
export function amountInRange(
  actual: number,
  typical: number,
  tolerance: number = AMOUNT_TOLERANCE,
): boolean {
  if (typical === 0) return true; // no typical amount recorded yet
  const lower = typical * (1 - tolerance);
  const upper = typical * (1 + tolerance);
  return actual >= lower && actual <= upper;
}

/**
 * Check if a date is within the recency window.
 * Practitioner rule: 3 months.
 */
export function isRecent(
  dateStr: string,
  monthsBack: number = PATTERN_RECENCY_MONTHS,
): boolean {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - monthsBack);
  return date >= cutoff;
}

/**
 * Count how many keywords from queryWords appear in patternWords.
 */
function countKeywordOverlap(queryWords: string[], patternWords: string[]): number {
  let count = 0;
  for (const qw of queryWords) {
    if (patternWords.includes(qw)) count++;
  }
  return count;
}

/**
 * Rolling average that converges toward recent values.
 */
function rollingAverage(current: number, newVal: number, count: number): number {
  // Weighted toward recent: weight = min(0.3, 1/count)
  const weight = Math.min(0.3, 1 / count);
  return current * (1 - weight) + newVal * weight;
}
