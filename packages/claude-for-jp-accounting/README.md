# Claude for JP Accounting

AI-powered bookkeeping automation for Japanese tax accountants.

## What it does

This Claude Code plugin provides 5 core skills for Japanese accounting firms:

1. **Tax Classifier** — 3-stage pipeline (exclusion, memory+keyword, AI fallback) that classifies transactions into standard 勘定科目 with consumption tax handling
2. **CSV Importer** — Auto-detects and imports CSV files from Yayoi, freee, MoneyForward, and generic bank/card exports
3. **Correction Memory** — Learns from every tax accountant correction and never repeats the same mistake. Gets cheaper and faster over time
4. **Monthly Closer** — Generates structured closing reports with category breakdown and month-over-month anomaly detection
5. **Nightly Batch** — Processes all client companies overnight via freee API with confidence-based routing

## Quick start

```bash
claude plugin install jp-accounting
```

Then run the setup wizard:

```
/jp-accounting:setup
```

This conducts a 10-minute interview to configure the plugin for your firm's conventions.

## Supported software

| Software | Import | API Integration |
|---|---|---|
| freee | CSV | OAuth API |
| Yayoi (弥生会計) | CSV (Format A/B) | -- |
| MoneyForward | CSV | -- |
| TKC | CSV | -- |
| Generic bank/card | CSV (column mapping) | -- |

## Key feature: Correction Memory

Every correction submitted by a tax accountant is permanently stored locally and applied to all future classifications across all client companies.

- Month 1: ~60% auto-classified by keywords
- Month 6: ~80% auto-classified by keywords + memory
- Month 12: ~90% auto-classified, minimal API costs

Memory is stored at `~/.cockpit-mcp/memory.json` (fully local, no cloud).

## Commands

| Command | Description |
|---|---|
| `/jp-accounting:setup` | Initial firm onboarding |
| `/jp-accounting:classify` | Classify a single transaction |
| `/jp-accounting:import` | Import and classify a CSV file |
| `/jp-accounting:report` | Generate a monthly report |
| `/jp-accounting:correct` | Submit a classification correction |
| `/jp-accounting:nightly` | Trigger nightly batch processing |

## Architecture

This plugin is a Markdown + JSON wrapper that references the `@kansei-link/cockpit` MCP server. It contains no TypeScript code -- only skill definitions, command definitions, agent definitions, and configuration.

## License

Apache-2.0 -- Copyright 2026 Synapse Arrows PTE. LTD.
