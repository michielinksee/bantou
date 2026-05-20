# @kansei-link/cockpit

MCP (Model Context Protocol) server for Japanese tax accountant workflow automation.

税理士業務の自動化を実現する MCP サーバー。仕訳分類・消費税判定・インボイス制度チェック・CSV取込を一気通貫で処理します。

## Installation

```bash
npm install @kansei-link/cockpit
```

## Quick Start

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cockpit": {
      "command": "npx",
      "args": ["@kansei-link/cockpit"],
      "env": {
        "COCKPIT_DATA_DIR": "/path/to/data"
      }
    }
  }
}
```

## Key Features

- **Two-stage classifier** -- Stage 1: keyword matching across 19 categories with 500+ keywords; Stage 2: Claude AI fallback for ambiguous entries
- **TaxRuleEngine** -- Consumption tax with 8%/10% reduced rate logic, overseas SaaS and ad platform detection, withholding tax calculation, asset tier classification, and invoice system (インボイス制度) checker with transitional period handling
- **CSV adapters** -- Auto-detect and parse Yayoi (弥生), freee, and generic CSV formats
- **Persistent memory** -- Linksee Memory integration that learns from corrections and recalls learned patterns
- **Confidence routing** -- Automatic routing to `auto_register`, `auto_register_with_log`, or `human_review` based on confidence scores and business rules
- **200 tests** -- Comprehensive test suite including end-to-end integration tests

## Architecture

The classification pipeline processes each transaction through sequential stages:

```
CSV Input
  |
  v
[CSV Adapter] -- Auto-detect format (Yayoi / freee / generic)
  |
  v
[Normalizer] -- Text normalization, full-width/half-width conversion
  |
  v
[Stage 1: Keyword Classifier] -- 19 categories, 500+ keyword rules
  |  (high confidence)         |  (low confidence)
  v                            v
[TaxRuleEngine]        [Stage 2: Claude AI Classifier]
  |                            |
  v                            v
[TaxRuleEngine]         [TaxRuleEngine]
  |                            |
  v                            v
[Confidence Router] -- auto_register / auto_register_with_log / human_review
  |
  v
[Memory Store] -- Persist corrections, recall patterns (Linksee Memory)
```

### TaxRuleEngine Details

- **Consumption tax**: Standard 10%, reduced rate 8% (food/beverages, newspapers)
- **Overseas detection**: SaaS platforms (AWS, Azure, GCP, etc.), advertising (Google Ads, Meta Ads, etc.) -- reverse charge applicable
- **Withholding tax**: Professional fees, royalties, and other specified payments
- **Asset classification**: Expense / depreciable asset / lump-sum depreciable asset / small-value asset based on acquisition cost tiers
- **Invoice checker**: Registration number validation, transitional credit periods (2023-10 through 2029-09)

## Configuration

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `COCKPIT_DATA_DIR` | Path to data directory containing keyword dictionaries and tax rules | `./data` |

### Data Files

The `data/` directory contains:

- `keyword-dict/jp-tax-baseline-v1.json` -- Keyword dictionary for Stage 1 classification (19 categories, 500+ rules)
- `tax-rules/jp-tax-rules-v1.json` -- Consumption tax rates, overseas SaaS/ad platforms, withholding rules, asset tiers, invoice system config
- `exclusion-rules/jp-tax-baseline-v1.json` -- Patterns to exclude non-classifiable transactions (ATM, salary, transfers, etc.)

## Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Build
npm run build
```

## License

MIT -- see [LICENSE](./LICENSE) for details.

Copyright (c) 2026 Synapse Arrows PTE. LTD.
