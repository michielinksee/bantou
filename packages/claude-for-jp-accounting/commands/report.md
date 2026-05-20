# /jp-accounting:report

Generate a monthly closing report for a client company.

## Usage

```
/jp-accounting:report <company-name> <month>
```

### Examples

```
/jp-accounting:report 株式会社サンプル 2026-01
/jp-accounting:report "ABC Trading" 2026-03
/jp-accounting:report サンプル商事 202604
```

## Input

- **company-name** — The client company name (partial match supported)
- **month** — Target month in YYYY-MM or YYYYMM format

## Generated sections

### Transaction summary
- Total count, total expenditure, total revenue
- Classification method breakdown (memory / keyword / AI / manual)

### Category breakdown (勘定科目別集計)
- Each category with count, amount, and percentage
- Sorted by amount descending

### Anomaly detection (前月比異常検知)
- Categories with month-over-month change exceeding +/- 50%
- Each anomaly includes current amount, previous amount, and change %
- Flagged for tax accountant review

### Classification quality
- Stage 0 exclusion count
- Memory hit rate
- AI fallback rate
- Manual review count

## Output format

Generated as structured Markdown displayed directly in the terminal.
Can be saved to a file, converted to PDF, or included in email.

## Notes

- Uses data from the most recent classification run
- Month-over-month comparison requires at least 2 months of data
- The first month will not include anomaly detection