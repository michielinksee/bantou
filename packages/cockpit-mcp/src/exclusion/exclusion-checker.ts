// Stage 0 exclusion checker.
//
// Reads jp-tax-baseline-v1.json exclusion rules and checks if a transaction
// should be escalated to human review (= NOT auto-classified).
//
// Match types:
// - regex: pattern match against field
// - any_keyword: substring list match
// - any_keyword_or_pattern: keyword + special detector (e.g., transfer_to_employee)
//
// Returns excluded:true with rule_id + reason if matched.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transaction, ExclusionResult } from '../classifier/types.js';
import { normalizeMemo } from '../classifier/normalize.js';
import { keywordMatches } from '../classifier/keyword-match.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function defaultDataDir(): string {
  const envDir = process.env.COCKPIT_DATA_DIR;
  if (envDir) return envDir;
  return path.resolve(__dirname, '../../../../data');
}

interface ExclusionRule {
  id: string;
  name_ja: string;
  name_en?: string;
  description?: string;
  priority: number;
  match: {
    type: 'regex' | 'any_keyword' | 'any_keyword_or_pattern' | 'exact';
    field: 'memo' | 'amount' | 'partner_name' | 'date';
    pattern?: string;
    flags?: string;
    keywords?: string[];
    patterns?: Array<{
      type: string;
      description?: string;
      requires_external_data?: string;
    }>;
  };
  alternative_patterns?: string[];
  action: {
    type: 'human_review' | 'alternative_workflow' | 'skip_silently';
    reason_template: string;
    suggested_next_step?: string;
    alternative_workflow_id?: string;
  };
}

interface ExclusionRules {
  version: string;
  locale: string;
  tax_jurisdiction: string;
  rules: ExclusionRule[];
}

export class ExclusionChecker {
  private rules: ExclusionRules;
  private rulesFile: string;

  constructor(rulesFile?: string, dataDir?: string) {
    const dir = dataDir || defaultDataDir();
    this.rulesFile = rulesFile || path.join(dir, 'exclusion-rules', 'jp-tax-baseline-v1.json');
    if (!fs.existsSync(this.rulesFile)) {
      throw new Error(
        `Exclusion rules not found at ${this.rulesFile}. ` +
        `Set COCKPIT_DATA_DIR env var or place data files at the expected path.`
      );
    }
    const raw = fs.readFileSync(this.rulesFile, 'utf8');
    this.rules = JSON.parse(raw);
    // Sort by priority
    this.rules.rules.sort((a, b) => a.priority - b.priority);
  }

  check(tx: Transaction, employees?: string[]): ExclusionResult {
    const memo = tx.memo || '';
    const normalizedMemo = normalizeMemo(memo);

    for (const rule of this.rules.rules) {
      const fieldValue = (() => {
        switch (rule.match.field) {
          case 'memo': return memo;
          case 'amount': return String(tx.amount);
          case 'partner_name': return tx.partner_name || '';
          case 'date': return tx.date;
          default: return '';
        }
      })();
      const normalizedField = normalizeMemo(fieldValue);

      let matchedKeyword: string | undefined;
      let matched = false;

      switch (rule.match.type) {
        case 'regex': {
          if (rule.match.pattern) {
            try {
              const re = new RegExp(rule.match.pattern, rule.match.flags);
              if (re.test(fieldValue)) {
                matched = true;
                matchedKeyword = `regex:${rule.match.pattern}`;
              }
            } catch {
              // invalid regex, skip
            }
          }
          // Also check alternative_patterns
          if (!matched && rule.alternative_patterns) {
            for (const alt of rule.alternative_patterns) {
              if (keywordMatches(normalizedField, normalizeMemo(alt))) {
                matched = true;
                matchedKeyword = alt;
                break;
              }
            }
          }
          break;
        }
        case 'any_keyword': {
          if (rule.match.keywords) {
            for (const kw of rule.match.keywords) {
              if (keywordMatches(normalizedField, normalizeMemo(kw))) {
                matched = true;
                matchedKeyword = kw;
                break;
              }
            }
          }
          break;
        }
        case 'any_keyword_or_pattern': {
          // First check keywords
          if (rule.match.keywords) {
            for (const kw of rule.match.keywords) {
              if (keywordMatches(normalizedField, normalizeMemo(kw))) {
                matched = true;
                matchedKeyword = kw;
                break;
              }
            }
          }
          // Then check patterns (= special detectors)
          if (!matched && rule.match.patterns) {
            for (const pattern of rule.match.patterns) {
              if (pattern.type === 'transfer_to_employee' && employees && employees.length > 0) {
                // Check if memo contains 振込 + employee name
                if (/振込|振替/.test(memo)) {
                  for (const emp of employees) {
                    if (keywordMatches(normalizedField, normalizeMemo(emp))) {
                      matched = true;
                      matchedKeyword = `transfer_to_employee:${emp}`;
                      break;
                    }
                  }
                  if (matched) break;
                }
              }
              // Other pattern types could be added here
            }
          }
          break;
        }
        case 'exact': {
          if (rule.match.keywords) {
            for (const kw of rule.match.keywords) {
              if (normalizedField === normalizeMemo(kw)) {
                matched = true;
                matchedKeyword = kw;
                break;
              }
            }
          }
          break;
        }
      }

      if (matched) {
        return {
          excluded: true,
          rule_id: rule.id,
          rule_name_ja: rule.name_ja,
          reason: rule.action.reason_template,
          suggested_next_step: rule.action.suggested_next_step,
          action_type: rule.action.type,
          alternative_workflow_id: rule.action.alternative_workflow_id,
          matched_keyword: matchedKeyword,
        };
      }
    }

    return { excluded: false };
  }

  getVersion(): string {
    return this.rules.version;
  }

  getRulesCount(): number {
    return this.rules.rules.length;
  }
}
