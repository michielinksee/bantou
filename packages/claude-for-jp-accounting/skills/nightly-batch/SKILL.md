---
description: freee APIで全顧問先を一括処理、信頼度別に自動分類/要確認を振り分け
---

# Nightly Batch

Batch-process all client companies overnight. Fetches unprocessed
transactions from freee API, runs the full classification pipeline,
and generates a summary for morning review.

## When to use

Invoke this skill when:

- The firm wants to automate daily transaction processing
- Setting up scheduled overnight runs via Anthropic Routines
- Manually triggering a batch run for all or selected clients

## Pipeline

The `nightly_run` tool executes the following steps for each client:

### 1. Fetch unprocessed transactions

- Calls `list_freee_companies` to enumerate all connected companies
- For each company, calls `list_freee_deals` with a date filter for
  unprocessed entries since the last run

### 2. Exclusion filter

Each transaction passes through Stage 0 exclusion (7 rules).
Excluded items are logged but not classified.

### 3. Memory recall

Query the correction memory for each transaction description.
Memory hits are classified instantly without API cost.

### 4. Keyword + AI classification

Remaining items flow through Stage 1 keyword matching, then
Stage 2 AI fallback for unmatched entries.

### 5. Confidence routing

Results are routed by confidence level:

| Confidence | Action | Review needed |
|---|---|---|
| **High** (>= 85%) | Auto-classified, logged | No |
| **Medium** (70-84%) | Auto-classified, flagged | Morning review |
| **Low** (< 70%) | Held for human review | Yes |

### 6. Summary generation

After all clients are processed, a batch summary is produced:

- Total clients processed
- Total transactions classified
- Breakdown by confidence tier
- Items requiring morning review (with details)
- API token usage for the run

## Scheduling with Anthropic Routines

The nightly batch is designed to work with Anthropic Routines for
automated scheduling. Typical configuration:

- **Schedule**: 02:00 JST daily (weekdays only)
- **Trigger**: Cron expression or Routines scheduler
- **Notification**: Summary posted to the firm's Slack or email

## freee API integration

The batch processor uses freee's OAuth API to:

- List all companies the firm has access to
- Fetch journal entries (仕訳) by date range
- Read transaction metadata (取引先, 勘定科目, 税区分)

The `FREEE_ACCESS_TOKEN` environment variable must be configured
in the plugin settings. Token refresh is handled automatically.

## Important notes

- Each nightly run is idempotent — re-running does not create
  duplicate classifications
- Failed client processing does not block other clients
- Run logs are stored locally for audit purposes
- The batch respects freee API rate limits (3,600 requests/hour)

## MCP tools used

- `nightly_run` — execute the full batch pipeline
- `list_freee_companies` — enumerate connected companies
- `list_freee_deals` — fetch unprocessed transactions
