// Stage 2 classifier: Claude API fallback.
//
// Used when Stage 1 keyword classifier returns no match. Sends transaction
// to Claude Haiku (= cheap + fast) with the 14-category system prompt and
// returns a classification with confidence (high/medium/low).
//
// Cost optimization:
// - System prompt (= 14 categories + rules) uses prompt caching → ~90% cost
//   reduction on repeated requests with same category context.
// - Model defaults to Haiku 4.5 (cheap, fast, sufficient for classification).
//   Override via CLAUDE_MODEL env var.
// - max_tokens = 200 (= classification response is short JSON).
//
// Falls back to unclassified if API errors, rate limits, or response is invalid.

import Anthropic from '@anthropic-ai/sdk';
import { Transaction, ClassificationResult } from './types.js';

export interface KeywordCategoryMeta {
  id: string;
  name_ja: string;
  name_en?: string;
  freee_account_code: number;
  default_tax_code: number;
  description?: string;
}

const DEFAULT_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

export class ClaudeClassifier {
  private client: Anthropic;
  private categories: KeywordCategoryMeta[];
  private categoryById: Map<string, KeywordCategoryMeta>;
  private systemPrompt: string;
  private model: string;

  constructor(apiKey: string, categories: KeywordCategoryMeta[], model: string = DEFAULT_MODEL) {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('ANTHROPIC_API_KEY is required for Stage 2 classifier');
    }
    this.client = new Anthropic({ apiKey });
    this.categories = categories;
    this.categoryById = new Map(categories.map(c => [c.id, c]));
    this.systemPrompt = this.buildSystemPrompt();
    this.model = model;
  }

  async classify(tx: Transaction): Promise<ClassificationResult> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 200,
        system: [
          {
            type: 'text',
            text: this.systemPrompt,
            cache_control: { type: 'ephemeral' }, // 90% cost reduction on warm cache
          },
        ],
        messages: [
          {
            role: 'user',
            content: this.buildUserPrompt(tx),
          },
        ],
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('');

      return this.parseResponse(text);
    } catch (err: any) {
      return this.fallback(`Stage 2 API error: ${err?.message || String(err)}`);
    }
  }

  private buildSystemPrompt(): string {
    const categoryList = this.categories.map(c =>
      `- ${c.id} (${c.name_ja}): ${c.description || 'no description'}`
    ).join('\n');

    return `You are a Japanese tax accounting classifier. Classify business transactions into 1 of 14 categories.

# Categories

${categoryList}

# Output format

Return JSON only. No markdown, no explanation outside JSON:

{
  "category_id": "<one of the category ids above>",
  "confidence": "high|medium|low",
  "reasoning": "<one short sentence in Japanese, 50 chars max>"
}

# Confidence rules

- **high**: Clear unambiguous match (e.g., "楽天モバイル ¥5,500" → communications obvious)
- **medium**: Leans toward one but other plausible (e.g., 海外 SaaS amount that could be utilities OR communications)
- **low**: 2+ categories equally plausible OR insufficient info

# Japanese tax accounting rules

- 飲食 ≤¥10,000 → meeting_meal (会議費)
- 飲食 >¥10,000 → entertainment (交際費)
- 海外 SaaS (Anthropic / OpenAI / GitHub / AWS / Cloudflare / etc.) → communications + tax_code 0 (国外取引)
- 軽減税率 (8%): 食品 / 新聞定期購読 / 持ち帰り飲食
- 標準税率 (10%): 店内飲食 / 通常物販 / 国内サービス
- 給与 / 借入 / 社保 / 投資 / ATM出金 / 公共料金 → これらは別途 exclusion check で escalate されるので、 通常分類すべきではない (= ただし keyword match で対象外な場合のみ、 確信あれば salary / loan etc. でもOK)`;
  }

  private buildUserPrompt(tx: Transaction): string {
    return `Transaction:
- amount: ${tx.amount} JPY
- memo: ${tx.memo}
- date: ${tx.date}
- partner: ${tx.partner_name || '(unknown)'}

Classify into 1 category. JSON only.`;
  }

  private parseResponse(text: string): ClassificationResult {
    try {
      // Extract JSON (= LLM sometimes wraps in markdown despite instructions)
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return this.fallback('Stage 2 returned no JSON');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (typeof parsed.category_id !== 'string') {
        return this.fallback('Stage 2 response missing category_id');
      }

      const cat = this.categoryById.get(parsed.category_id);
      if (!cat) {
        return this.fallback(`Stage 2 returned unknown category: ${parsed.category_id}`);
      }

      const confidence: 'high' | 'medium' | 'low' =
        parsed.confidence === 'high'
          ? 'high'
          : parsed.confidence === 'medium'
            ? 'medium'
            : 'low';

      const reasoning = typeof parsed.reasoning === 'string'
        ? parsed.reasoning.slice(0, 100)
        : 'AI classification';

      return {
        classified: true,
        category_id: cat.id,
        category_name_ja: cat.name_ja,
        freee_account_code: cat.freee_account_code,
        tax_code: cat.default_tax_code,
        confidence,
        match_reason: `Stage 2 (${this.model}): ${reasoning}`,
        classifier_version: `jp-tax-baseline-v1.0.0+claude/${this.model}`,
      };
    } catch (err: any) {
      return this.fallback(`Stage 2 parse error: ${err?.message || String(err)}`);
    }
  }

  private fallback(reason: string): ClassificationResult {
    return {
      classified: false,
      confidence: 'none',
      match_reason: reason,
      classifier_version: `jp-tax-baseline-v1.0.0+claude/${this.model}`,
    };
  }

  getModel(): string {
    return this.model;
  }
}
