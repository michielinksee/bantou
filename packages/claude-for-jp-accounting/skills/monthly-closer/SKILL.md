# Monthly Closer

Generate structured monthly closing reports for client companies.
Produces a Markdown summary with transaction statistics, category
breakdowns, and anomaly detection.

## When to use

Invoke this skill when:

- End of month arrives and the tax accountant needs a closing summary
- A client requests a monthly financial overview
- The firm needs to review classification quality for the period

## Report structure

The `generate_monthly_report` tool produces a report with these sections:

### 1. Summary header

- Company name, reporting period (year/month)
- Generation timestamp
- Data source (freee / Yayoi / MF / imported CSV)

### 2. Transaction statistics

- Total transaction count
- Total expenditure (支出合計)
- Total revenue (収入合計)
- Classification breakdown: auto-classified vs. manually reviewed
- Memory hit rate for the period

### 3. Category breakdown (勘定科目別集計)

Table showing each category with:

| 勘定科目 | 件数 | 金額 | 構成比 |
|---|---|---|---|
| 旅費交通費 | 45 | ¥234,500 | 18.2% |
| 会議費 | 32 | ¥128,000 | 9.9% |
| ... | ... | ... | ... |

### 4. Month-over-month anomaly detection

Compares each category against the previous month. Flags any category
where the amount changed by **plus or minus 50%** or more.

Example flags:
- "広告宣伝費: ¥580,000 (前月比 +210%) — 要確認"
- "外注費: ¥45,000 (前月比 -65%) — 要確認"

Anomalies are not errors — they are prompts for the tax accountant
to verify that large swings are expected.

### 5. Classification quality metrics

- Stage 0 exclusion count
- Stage 1 keyword/memory hit count
- Stage 2 AI classification count
- Items requiring manual review (low confidence)

## Output format

Reports are generated as Markdown by default. The output can be:

- Displayed directly in the terminal
- Saved to a file for archival
- Shared with clients via email or converted to PDF

## MCP tools used

- `generate_monthly_report` — produce the full monthly summary
