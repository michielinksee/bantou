---
description: 取引を勘定科目に3段階パイプラインで自動分類（除外→記憶+キーワード→AI）
---

# Tax Classifier

Classify Japanese business transactions into standard accounting categories
(kanjou-kamoku / 勘定科目) using a 3-stage pipeline that minimizes API costs
and maximizes accuracy.

## When to use

Invoke this skill whenever the user provides a transaction description
(e.g. "スタバ 渋谷店 ¥580") and needs:

- A 勘定科目 classification
- A 税区分 (consumption-tax treatment) assignment
- A confidence score

## Pipeline overview

### Stage 0 — Exclusion check (7 rules)

Before any classification attempt, run `check_exclusion` to filter out
non-classifiable items. The standard rules exclude:

1. Transfer-to-self (振替) entries
2. Opening / closing balance lines
3. Duplicate reversed entries (赤伝)
4. Summary / subtotal rows
5. Tax-payment lines handled separately
6. Payroll deduction detail lines
7. Memo-only entries with zero amount

If an item is excluded, return the exclusion reason without proceeding.

### Stage 1 — Memory recall + keyword dictionary (14 categories)

Query `recall_memory` first. If the exact vendor or pattern has been
corrected before, use the memorized classification immediately.

If no memory hit, match against the 14-category keyword dictionary:

| Category | Examples |
|---|---|
| 会議費 | cafe, meeting room |
| 交際費 | dinner with client, gift |
| 旅費交通費 | train, taxi, hotel |
| 通信費 | phone, internet, postage |
| 消耗品費 | office supplies, toner |
| 地代家賃 | rent, parking |
| 水道光熱費 | electricity, gas, water |
| 支払手数料 | bank fee, service charge |
| 広告宣伝費 | ads, marketing |
| 外注費 | subcontractor, freelancer |
| 福利厚生費 | employee meal, health check |
| 保険料 | insurance premium |
| 租税公課 | stamp duty, property tax |
| 雑費 | miscellaneous (last resort) |

### Stage 2 — Claude AI fallback

When keyword matching fails or confidence is below threshold, call
`classify_transaction` which uses Claude to analyze the description
with full context from the firm's CLAUDE.md configuration.

## Consumption tax handling

Always assign a tax treatment. Be careful with the rates:

- **10%** — standard rate (標準税率)
- **8% reduced** — food/beverage for takeout, newspaper subscriptions (軽減税率)
- **Exempt** (非課税) — land rent, insurance, interest
- **Non-taxable** (不課税) — donations, damages, foreign transactions

When uncertain between 10% and 8%, flag as "confirmation needed" rather
than guessing. A wrong tax rate causes real compliance risk.

## Important guidelines

- The tax accountant's judgment is **always final**. This tool assists; it
  does not replace professional judgment.
- Items with confidence below 70% should be surfaced as "要確認"
  (confirmation needed) with the top-2 candidate categories shown.
- Never silently auto-classify ambiguous items at high volume. Surface
  uncertainty clearly.

## MCP tools used

- `classify_transaction` — full AI classification
- `check_exclusion` — Stage 0 exclusion filter
- `recall_memory` — check correction history
