# /jp-accounting:classify

Classify a single Japanese business transaction through the full
3-stage pipeline.

## Usage

```
/jp-accounting:classify <description>
```

### Examples

```
/jp-accounting:classify スタバ 渋谷店 ¥580
/jp-accounting:classify Amazon Web Services ¥45,000
/jp-accounting:classify タクシー 新宿→品川 ¥3,200
/jp-accounting:classify 取引先接待 居酒屋 6名 ¥48,000
```

## Input

A free-text transaction description. Can include:

- Vendor/store name
- Amount (optional but improves accuracy)
- Location or context details
- Number of participants (relevant for 会議費 vs 交際費)

## Pipeline execution

The command runs the full classification pipeline:

1. **Exclusion check** — Is this a classifiable transaction?
2. **Memory recall** — Has this vendor been corrected before?
3. **Keyword match** — Does it match a known category pattern?
4. **AI classification** — Claude analyzes the description (if needed)

## Output

Returns a structured result:

```
勘定科目: 会議費
税区分:   課税仕入 10%
信頼度:   92%
判定方法: Memory (過去の修正パターン一致)
```

If confidence is below 70%, the output shows the top-2 candidates:

```
勘定科目: 会議費 or 交際費 (要確認)
税区分:   課税仕入 10%
信頼度:   58%
判定方法: AI (低信頼度 — 税理士確認推奨)
候補1: 会議費 (58%) — 1人あたり¥8,000、5,000円基準超過の可能性
候補2: 交際費 (35%) — 接待目的の場合
```

## Notes

- If the transaction is excluded (Stage 0), the exclusion reason is shown
- Classification results are not automatically saved; use `/jp-accounting:correct`
  to submit corrections if the result is wrong
