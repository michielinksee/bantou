# /jp-accounting:nightly

Trigger the nightly batch processing run for all connected client
companies.

## Usage

```
/jp-accounting:nightly
```

No arguments required. Processes all companies connected via freee API.

## What happens

1. **Enumerate companies** — Lists all companies accessible via the
   configured freee access token
2. **Fetch transactions** — For each company, fetches unprocessed
   transactions since the last run
3. **Classify** — Runs the full 3-stage pipeline on every transaction:
   - Stage 0: Exclusion filter
   - Stage 1: Memory recall + keyword matching
   - Stage 2: AI classification (fallback)
4. **Route by confidence** — Sorts results into tiers:
   - High (>= 85%): auto-classified, no review needed
   - Medium (70-84%): auto-classified, flagged for morning review
   - Low (< 70%): held for human review
5. **Generate summary** — Produces a batch run summary

## Output

A summary is displayed after processing:

```
夜間バッチ処理完了
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
処理企業数:        12
総取引数:         847
除外:             63
自動分類 (高):    612
自動分類 (中):    108
要確認 (低):       64
Memory ヒット率:  38.2%
API トークン使用:  ~12,400
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Low-confidence items are listed with details for morning review.

## Scheduling

For automated nightly execution, configure via Anthropic Routines
or the system scheduler. Recommended schedule: 02:00 JST weekdays.

## Prerequisites

- `FREEE_ACCESS_TOKEN` must be configured in the plugin settings
- At least one freee company must be connected
- For non-freee clients, use `/jp-accounting:import` instead

## Notes

- The batch is idempotent; re-running does not create duplicates
- If a company fails, processing continues for remaining companies
- Run logs are stored locally for audit trail
