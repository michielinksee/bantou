// Two-stage classifier orchestrator.
//
// Stage 1: keyword dict (= fast, deterministic, free)
// Stage 2: Claude API fallback (= slow-ish, AI, paid)
//
// If Stage 1 matches → return immediately (= ~95% of typical transactions).
// If no match → try Stage 2 (= remaining ~5%). If both miss → return
// unclassified (= human review queue).

import { KeywordClassifier } from './keyword-classifier.js';
import { ClaudeClassifier, KeywordCategoryMeta } from './claude-classifier.js';
import { Transaction, ClassificationResult } from './types.js';

export interface TwoStageResult extends ClassificationResult {
  stage: 1 | 2 | 'unclassified';
}

export class TwoStageClassifier {
  private stage1: KeywordClassifier;
  private stage2: ClaudeClassifier | null;

  constructor(stage1: KeywordClassifier, stage2?: ClaudeClassifier | null) {
    this.stage1 = stage1;
    this.stage2 = stage2 || null;
  }

  async classify(tx: Transaction): Promise<TwoStageResult> {
    // Stage 1: keyword match
    const s1 = this.stage1.classify(tx);
    if (s1.classified) {
      return { ...s1, stage: 1 };
    }

    // Stage 2: Claude API fallback (= only if configured)
    if (this.stage2) {
      const s2 = await this.stage2.classify(tx);
      if (s2.classified) {
        return { ...s2, stage: 2 };
      }
      // Stage 2 also failed → return its failure reason
      return { ...s2, stage: 'unclassified' };
    }

    // No Stage 2 configured → return Stage 1 result (unclassified)
    return { ...s1, stage: 'unclassified' };
  }

  hasStage2(): boolean {
    return this.stage2 !== null;
  }

  getStage1(): KeywordClassifier {
    return this.stage1;
  }

  getStage2(): ClaudeClassifier | null {
    return this.stage2;
  }
}

/**
 * Helper: extract category metadata from keyword dict for ClaudeClassifier construction.
 * Reads from KeywordClassifier's internal data via a getCategories() method.
 */
export function extractCategoryMeta(classifier: KeywordClassifier): KeywordCategoryMeta[] {
  return classifier.getCategoriesMeta();
}
