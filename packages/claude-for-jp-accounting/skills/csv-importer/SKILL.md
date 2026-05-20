# CSV Importer

Import transaction CSV files exported from Japanese accounting software.
Auto-detects the file format and runs the full classification pipeline
on every imported row.

## When to use

Invoke this skill when the user wants to:

- Import a CSV file from Yayoi, freee, MoneyForward, or TKC
- Process a generic bank/credit-card CSV export
- Bulk-classify transactions from a spreadsheet

## Supported formats

### Yayoi (弥生会計)

- **Format A** — Journal entry export (仕訳日記帳)
  Columns: 日付, 借方勘定科目, 借方金額, 貸方勘定科目, 貸方金額, 摘要
- **Format B** — Simplified ledger (簡易帳簿)
  Columns: 日付, 科目, 金額, 摘要

### freee

- Standard CSV export from the 取引一覧 screen
  Columns: 取引日, 勘定科目, 税区分, 金額, 備考

### MoneyForward (MF クラウド会計)

- Journal CSV export
  Columns: 取引日, 借方科目, 借方金額, 貸方科目, 貸方金額, 摘要

### Generic CSV

For bank statements and credit card CSVs, the importer supports
interactive column mapping. The user specifies which columns
correspond to date, amount, and description.

## Format auto-detection

The `import_csv` tool inspects the header row and first 5 data rows to
determine the format. Detection heuristics:

1. Check for known header patterns (e.g. "借方勘定科目" = Yayoi Format A)
2. Count columns and match against known schemas
3. Detect encoding (Shift_JIS vs UTF-8) and re-encode if needed
4. Fall back to generic mode if no match

## Encoding requirements

Japanese CSV files often use Shift_JIS or CP932 encoding. The importer
handles conversion automatically, but for best results:

- Re-save files as **UTF-8 with BOM** before importing
- If garbled characters (文字化け) appear, specify encoding explicitly
- Excel-exported CSVs from Japanese Windows are typically CP932

## Post-import pipeline

After import, every row automatically flows through:

1. Stage 0 exclusion check (filter non-classifiable rows)
2. Memory recall (apply past corrections)
3. Stage 1 keyword classification
4. Stage 2 AI fallback (for unmatched items)
5. Confidence routing (high/medium/low)

Results are returned as a summary table showing classified, excluded,
and needs-review counts.

## MCP tools used

- `import_csv` — parse, detect format, and classify all rows
