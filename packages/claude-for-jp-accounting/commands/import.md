---
description: 会計ソフトCSVの取り込み・全件自動分類
---

# /bantou:import

Import a CSV file from Japanese accounting software and classify all
transactions automatically.

## Usage

```
/jp-accounting:import <file-path>
```

### Examples

```
/jp-accounting:import ./exports/yayoi_202601.csv
/jp-accounting:import C:\Users\会計\freee_export.csv
/jp-accounting:import ~/Downloads/mf_journal.csv
```

## Input

An absolute or relative path to a CSV file. The importer auto-detects:

- **File format** — Yayoi (Format A/B), freee, MoneyForward, or generic
- **Encoding** — UTF-8, Shift_JIS, CP932 (auto-converted to UTF-8)
- **Delimiter** — comma, tab, or semicolon

## Processing flow

1. Parse the CSV file and detect format
2. Validate headers and data structure
3. Run each row through the classification pipeline:
   - Stage 0: Exclusion filter
   - Stage 1: Memory recall + keyword matching
   - Stage 2: AI fallback (for unmatched rows)
4. Generate a summary report

## Output

After processing, a summary table is displayed:

```
インポート結果: yayoi_202601.csv
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
総行数:           142
除外 (Stage 0):    12
自動分類 (高信頼):  98
自動分類 (中信頼):  18
要確認 (低信頼):    14
Memory ヒット:     34 (26.2%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Low-confidence items are listed individually for review.

## Encoding troubleshooting

If characters appear garbled (文字化け), try:

1. Open the CSV in a text editor and re-save as UTF-8
2. Specify encoding explicitly when prompted
3. Check that the file was not corrupted during download

## Notes

- Large files (>1,000 rows) are processed in batches of 100
- Progress is shown during processing
- Results can be exported or used with `/jp-accounting:report`
