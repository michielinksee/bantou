# /jp-accounting:correct

Submit a correction for a misclassified transaction. The correction is
permanently stored in memory and applied to all future matches.

## Usage

```
/jp-accounting:correct <transaction> --to <correct-category> [--reason <reason>]
```

### Examples

```
/jp-accounting:correct "スタバ 渋谷店 ¥580" --to 会議費
/jp-accounting:correct "Zoom月額" --to 通信費 --reason "ビデオ会議サービスは通信費で統一"
/jp-accounting:correct "Amazon ¥12,000" --to 消耗品費 --reason "事務用品購入"
```

## Input

- **transaction** — The transaction description to correct (quoted string)
- **--to** — The correct 勘定科目 (accounting category)
- **--reason** — Optional reason for the correction (recommended)

## What happens

1. The correction is validated (correct category must be a valid 勘定科目)
2. The original classification and the correction are logged
3. The correction is stored in local memory (`~/.cockpit-mcp/memory.json`)
4. All future transactions matching this vendor/pattern will use the
   corrected classification automatically

## Correction scope

- Corrections apply **firm-wide** across all client companies
- The pattern extracted from the transaction description is normalized
  (e.g., branch names may be stripped for broader matching)
- If a correction conflicts with a previous one, the user is prompted
  to resolve the conflict

## Viewing corrections

To see all stored corrections, use the memory recall feature:

```
/jp-accounting:classify [vendor-name]
```

The classification output will show if a Memory hit was used and
which correction it came from.

## Undoing corrections

Corrections are permanent by default. To remove a correction:

1. Edit `~/.cockpit-mcp/memory.json` directly
2. Or submit a new correction that overrides the previous one

## Notes

- Including a reason with `--reason` helps future auditing
- Corrections with reasons are weighted higher in pattern matching
- The memory file can be backed up and shared across machines
