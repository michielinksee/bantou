---
description: 税理士の修正を永久記憶し同じ間違いを二度としない学習エンジン
---

# Correction Memory

Persistent memory system that learns from tax accountant corrections.
Every correction is permanently stored and never repeated. This is the
core differentiator of the plugin — it gets smarter with every use.

## When to use

Invoke this skill when:

- A tax accountant corrects a classification ("this should be 交際費, not 会議費")
- The user wants to check what past corrections exist for a vendor
- The system needs to recall learned patterns during classification

## How it works

### Correction flow

1. Tax accountant reviews a classification result
2. If incorrect, they submit a correction with:
   - Original classification
   - Correct classification (勘定科目 + 税区分)
   - Reason for correction (optional but valuable)
3. The correction is stored in local memory permanently
4. All future transactions matching the same pattern use the corrected
   classification automatically (Memory hit in Stage 1)

### Pattern matching

Corrections are stored as vendor/description patterns. When a new
transaction arrives, the memory is queried for matches:

- Exact vendor name match ("スタバ 渋谷店" matches "スタバ 渋谷店")
- Normalized vendor match ("スタバ" matches any Starbucks location)
- Description keyword match (configurable per correction)

### Cross-client application

Corrections apply **across all client companies** in the firm.
If a tax accountant corrects "Zoom" from 通信費 to 支払手数料 for
Client A, that correction automatically applies to Clients B, C, etc.

This is intentional — accounting conventions are firm-level decisions,
not per-client. Individual client overrides are supported but rare.

## Storage location

Memory is stored locally at `~/.cockpit-mcp/memory.json`. This is
fully local — no data is sent to any cloud service.

The memory file is human-readable JSON and can be manually edited,
backed up, or transferred between machines.

## Cost reduction over time

As Memory accumulates corrections, the proportion of transactions
handled by Stage 1 (free, instant) increases while Stage 2 (API call,
costs tokens) decreases. Typical trajectory:

- Month 1: ~60% keyword, ~30% AI, ~10% manual
- Month 6: ~80% keyword+memory, ~15% AI, ~5% manual
- Month 12: ~90% keyword+memory, ~8% AI, ~2% manual

This means the plugin becomes both faster and cheaper over time.

## Important notes

- Memory corrections are **permanent** unless explicitly deleted
- The tax accountant can review all stored corrections at any time
- Conflicting corrections (same vendor, different categories) are
  flagged for human resolution
- Memory export/import is supported for firm migration scenarios

## MCP tools used

- `correct_classification` — store a new correction
- `recall_memory` — query memory for matching patterns
