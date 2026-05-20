# Cockpit MCP — Keyword Dictionary

## What this is

Cockpit MCP's **Stage 1 classifier** uses keyword dictionaries to map raw transaction 摘要 (= memo strings) to 勘定科目 (= account categories) + 税区分 (= tax codes).

This is the **practitioner-style 14 categories × 100 keywords** approach, packaged as portable JSON for free distribution. Each tax jurisdiction has its own dictionary file:

- `jp-tax-baseline-v1.json` — Japanese tax accounting baseline (14 categories)
- (future) `sg-tax-baseline-v1.json` — Singapore GST + ACRA-aligned categories
- (future) `us-tax-baseline-v1.json` — US sales tax + GAAP categories

## How matching works

1. **Normalize** 摘要 string: 全角 → 半角、 大文字 → 小文字、 trim whitespace
2. **Iterate categories** (top to bottom) and for each, check if any keyword is a substring of the normalized 摘要
3. **First match wins**: if "Suica" matches in `travel`, classifier returns `travel`. No further categories checked.
4. **Apply amount thresholds** (if defined): e.g., 会議費 only matches ≤¥10K; if amount > ¥10K, auto-redirect to 交際費 via `amount_overflow_category`
5. **Apply special patterns** (if defined): e.g., `transfer_professional` requires the keyword AND a 振込 verb in the 摘要
6. If no category matches → fallback to **Stage 2** (Claude API classifier with confidence high/medium/low)

## Versioning

- `v1.0.0` = initial baseline (= 14 categories × ~50 keywords average)
- `v1.x` = expand to 100 keywords/category via dogfood iterations
- `v2.x` = community-tuned (= Cockpit user 集合知 で keyword 改善)
- `v3.x` = AI-discovered keywords (= 過去 anonymous data から AI が新 keyword 発見)

## How to extend

### Add new keyword to existing category

1. Open the relevant `*-tax-baseline-v*.json`
2. Find the category by `id`
3. Append your keyword to the `keywords` array
4. Test: run smoke test against your test fixtures
5. Open PR (= reviewer must verify keyword is unambiguous + likely to match real transactions)

### Add new category

1. Define new entry in `categories` array with all required fields (= `id`, `name_ja`, `freee_account_code`, `default_tax_code`, `keywords`)
2. Choose `freee_account_code` from freee's standard chart of accounts
3. Determine `default_tax_code` based on Japanese 消費税 rules
4. Decide priority (= where in the categories array it goes — earlier = higher priority)
5. Add at least 10 initial keywords to bootstrap
6. Run smoke test
7. Open PR (= reviewer verifies category is genuinely needed and not a duplicate)

### Add jurisdiction-specific dictionary

1. Copy `jp-tax-baseline-v1.json` → `<country-code>-tax-baseline-v1.json`
2. Update `locale` and `tax_jurisdiction` fields
3. Replace categories with the target country's chart of accounts
4. Provide a community maintainer (= regional accountant) to validate
5. Open PR

## Partnership note

This dictionary is designed to be **co-authored with tax practitioners** starting Year 1 closed beta:

- Practitioner's 6-month-built 14 categories × 100 keywords → contributed as anonymous PR
- Co-author credit in `maintainer` field
- Quarterly merge of practitioner improvements + community improvements
- See `synapse-arrows-playbook/04-tooling-gaps/10-kansei-link-cockpit-strategy.md` §11 for partnership terms

## Validation

```bash
# Run schema validation (TODO: add to CI)
node scripts/validate-keyword-dict.js data/keyword-dict/*.json
```

## Smoke test scenarios

`packages/cockpit-mcp/tests/keyword-dict.test.ts` covers:

1. Basic substring match (= "Suica" → travel)
2. Multi-keyword match (= 上 category 優先)
3. Amount threshold (= "スターバックス @ ¥15,000" → entertainment, NOT meeting_meal)
4. Special pattern: salary employee detection (= 給与 + 従業員名 list match)
5. Special pattern: 振込 + 士業名 → professional_fee + 取引先抽出
6. Special pattern: 振込 + カナ人名 → outsourcing + 発生日前月末調整
7. No-match → Stage 2 fallback signal
8. Normalize: 全角 / カタカナ / 半角混在の 摘要

## See also

- Schema: [`../keyword-dict-schema.json`](../keyword-dict-schema.json)
- Architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- 7 exclusion rules: [`../exclusion-rules/README.md`](../exclusion-rules/README.md) (= Stage 0 = before classifier runs)
- Strategy: [synapse-arrows-playbook Doc 10](https://github.com/michielinksee/synapse-arrows-playbook/blob/main/04-tooling-gaps/10-kansei-link-cockpit-strategy.md)
