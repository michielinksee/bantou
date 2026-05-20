# Cockpit MCP — Exclusion Rules

## What this is

Cockpit MCP's **Stage 0 filter** runs BEFORE the keyword/AI classifier. It identifies transactions that should NOT be auto-journalized — they get escalated to human review instead.

This is the **practitioner-style 7-rule exclusion** pattern. From the reference note:

> 自動仕訳で一番怖いのは「本来仕訳すべきでないものを仕訳してしまう」ことです。
> 「何を自動化して、何を人間が見るか」の線引きを明確にしているからこそ、安全に60社を回せています。

The 7 rules:

1. **内容不明デビット** — "デビット+数字" だけで店名なし → 人間が利用明細確認
2. **借入金返済** — 元本+利息 内訳必要 → freee 借入金返済 wizard 推奨
3. **社会保険料・税金** — 法定福利費 / 預り金 / 租税公課 判断必要
4. **給与支払い** — 給与計算結果と連動必要 → freee 人事労務 wizard
5. **投資・資産運用** — 投資有価証券 / 雑所得 / 譲渡益 判断、 税理士判断
6. **ATM出金・残高調整** — 口座振替別処理、 cash_balance_adjustment workflow へ
7. **公共料金** — 事業 vs 個人按分必要 → 手動比率設定

## How matching works

```
Transaction (= memo, amount, date, partner_name)
       ↓
Stage 0 (Exclusion Rules)
       ├─ Rule 1 match? → human_review (rule_id, reason)
       ├─ Rule 2 match? → human_review
       ├─ ...
       └─ No match → proceed to Stage 1
                        ↓
                  Stage 1 (Keyword Dict)
                        ├─ Match? → return classification
                        └─ No match → Stage 2
                                        ↓
                                  Stage 2 (Claude API fallback)
                                  → return with confidence (high/medium/low)
                                  → low confidence → human review
```

## Action types

- **human_review**: Transaction goes to "確認待ち" queue. Tax accountant reviews + manually classifies.
- **alternative_workflow**: Transaction is routed to a different workflow (e.g., ATM withdrawal → cash_balance_adjustment, NOT auto-journalized but auto-handled).
- **skip_silently**: Transaction is ignored entirely (= for noise filtering, rare use).

## Per-firm overrides

Each Cockpit user (= 税理士事務所) can define overrides:

```json
{
  "firm_id": "tanaka-tax-office",
  "rule_overrides": [
    {
      "rule_id": "investment",
      "additional_keywords": ["弊社専用ファンド名"],
      "exclude_keywords": ["NISA"]
    },
    {
      "rule_id": "salary_payment",
      "disabled": true,
      "reason": "うちの事務所は freee HR 連動完成済"
    }
  ]
}
```

→ Stored in Cockpit Web Dashboard, applied per-instance via Cockpit MCP.

## Validation

```bash
# Schema validation (TODO: add to CI)
node scripts/validate-exclusion-rules.js data/exclusion-rules/*.json
```

## Smoke test scenarios

`packages/cockpit-mcp/tests/exclusion-rules.test.ts` covers:

1. "デビット 12345" → unknown_debit, human_review
2. "公庫 利息支払い" → loan_repayment
3. "源泉所得税納付" → social_insurance_tax
4. "給与 山田太郎" + freee HR list 含む → salary_payment
5. "野村證券 譲渡代金" → investment
6. "セブン銀行ATM出金" → atm_withdrawal → cash_balance_adjustment workflow
7. "東京水道局" → utilities (公共料金)
8. "Suica チャージ" → no match → proceed to Stage 1 (= 旅費交通費 にいく)

## Partnership note

These 7 rules are the canonical practitioner playbook. Year 1 closed beta:
- Tax practitioner reviews + signs off (= 「これが私の 7 rule で間違いない」)
- Co-author credit in `maintainer` field
- His extensions (= 8th, 9th rule) merged via PR

## See also

- Schema: [`../exclusion-rules-schema.json`](../exclusion-rules-schema.json)
- Architecture: [`../../docs/architecture.md`](../../docs/architecture.md)
- keyword-dict (Stage 1): [`../keyword-dict/README.md`](../keyword-dict/README.md)
- Strategy: [synapse-arrows-playbook Doc 10](https://github.com/michielinksee/synapse-arrows-playbook/blob/main/04-tooling-gaps/10-kansei-link-cockpit-strategy.md)
