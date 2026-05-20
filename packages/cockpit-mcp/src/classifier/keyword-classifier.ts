// Stage 1 keyword classifier.
//
// Reads jp-tax-baseline-v1.json keyword dictionary and matches a transaction
// against the 14 categories using substring search after normalization.
//
// Match algorithm:
// 1. Normalize memo (= 全角→半角, lowercase, trim)
// 2. For each category (top to bottom):
//    a. Check amount threshold (min/max)
//    b. Iterate keywords; first substring match wins category
//    c. If matched but amount exceeds threshold_max, redirect to amount_overflow_category
// 3. No match → return classified: false (= proceed to Stage 2)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction, ClassificationResult } from './types.js';
import { normalizeMemo } from './normalize.js';
import { findFirstMatchingKeyword } from './keyword-match.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate the data directory (= prefer env var, else relative to package)
function defaultDataDir(): string {
  const envDir = process.env.COCKPIT_DATA_DIR;
  if (envDir) return envDir;
  // In dev: src/classifier/ → ../../../data
  // In prod (dist/): dist/classifier/ → ../../../data
  return path.resolve(__dirname, '../../../../data');
}

interface KeywordCategory {
  id: string;
  name_ja: string;
  name_en?: string;
  freee_account_code: number;
  default_tax_code: number;
  description?: string;
  amount_threshold_min?: number;
  amount_threshold_max?: number;
  amount_overflow_category?: string;
  special_pattern?: string;
  keywords: string[];
  _normalized_keywords?: string[]; // pre-computed
}

interface KeywordDict {
  version: string;
  locale: string;
  tax_jurisdiction: string;
  tax_code_default: number;
  categories: KeywordCategory[];
}

export class KeywordClassifier {
  private dict: KeywordDict;
  private dictFile: string;

  constructor(dictFile?: string, dataDir?: string) {
    const dir = dataDir || defaultDataDir();
    this.dictFile = dictFile || path.join(dir, 'keyword-dict', 'jp-tax-baseline-v1.json');
    if (!fs.existsSync(this.dictFile)) {
      throw new Error(
        `Keyword dictionary not found at ${this.dictFile}. ` +
        `Set COCKPIT_DATA_DIR env var or place data files at the expected path.`
      );
    }
    const raw = fs.readFileSync(this.dictFile, 'utf8');
    this.dict = JSON.parse(raw);

    // Pre-normalize all keywords once
    for (const cat of this.dict.categories) {
      cat._normalized_keywords = cat.keywords.map(normalizeMemo);
    }
  }

  classify(tx: Transaction): ClassificationResult {
    const normalized = normalizeMemo(tx.memo);

    for (const cat of this.dict.categories) {
      // Check amount threshold (min)
      if (cat.amount_threshold_min !== undefined && tx.amount < cat.amount_threshold_min) {
        continue;
      }

      // Find matching keyword (ASCII = word boundary, CJK = substring)
      const keywords = cat._normalized_keywords || [];
      const matchedKeywordIdx = findFirstMatchingKeyword(normalized, keywords);
      const matchedKeyword = matchedKeywordIdx >= 0 ? cat.keywords[matchedKeywordIdx] : undefined;

      if (matchedKeywordIdx === -1) continue;

      // Check amount threshold (max) → redirect if needed
      if (cat.amount_threshold_max !== undefined && tx.amount > cat.amount_threshold_max) {
        if (cat.amount_overflow_category) {
          const redirectedCat = this.dict.categories.find(c => c.id === cat.amount_overflow_category);
          if (redirectedCat) {
            return {
              classified: true,
              category_id: redirectedCat.id,
              category_name_ja: redirectedCat.name_ja,
              freee_account_code: redirectedCat.freee_account_code,
              tax_code: redirectedCat.default_tax_code,
              confidence: 'high', // amount-redirect is deterministic
              matched_keyword: matchedKeyword,
              match_reason: `Matched "${matchedKeyword}" in "${cat.id}" but amount ${tx.amount} > ${cat.amount_threshold_max}, redirected to "${redirectedCat.id}"`,
              classifier_version: this.dict.version,
              amount_override_redirect: cat.id,
              special_pattern: redirectedCat.special_pattern,
            };
          }
        }
      }

      // Normal match
      return {
        classified: true,
        category_id: cat.id,
        category_name_ja: cat.name_ja,
        freee_account_code: cat.freee_account_code,
        tax_code: cat.default_tax_code,
        confidence: 'high',
        matched_keyword: matchedKeyword,
        match_reason: `Matched keyword "${matchedKeyword}" in category "${cat.id}"`,
        classifier_version: this.dict.version,
        special_pattern: cat.special_pattern,
      };
    }

    return {
      classified: false,
      confidence: 'none',
      match_reason: 'No keyword match in any category',
      classifier_version: this.dict.version,
    };
  }

  getVersion(): string {
    return this.dict.version;
  }

  getCategoriesCount(): number {
    return this.dict.categories.length;
  }

  getKeywordsCount(): number {
    return this.dict.categories.reduce((sum, c) => sum + c.keywords.length, 0);
  }

  /**
   * Returns category metadata for Stage 2 Claude classifier construction.
   */
  getCategoriesMeta() {
    return this.dict.categories.map(c => ({
      id: c.id,
      name_ja: c.name_ja,
      name_en: c.name_en,
      freee_account_code: c.freee_account_code,
      default_tax_code: c.default_tax_code,
      description: c.description,
    }));
  }
}
