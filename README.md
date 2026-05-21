# KanseiLink Cockpit

Monorepo for **@kansei-link/cockpit** — an MCP server for Japanese accounting workflow automation.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`packages/cockpit-mcp`](./packages/cockpit-mcp/) | MCP server — two-stage classifier + TaxRuleEngine | ✅ [npm](https://www.npmjs.com/package/@kansei-link/cockpit) |
| `packages/cockpit-dashboard` | Web dashboard (coming soon) | 🚧 |

## Quick Start

```bash
npm install @kansei-link/cockpit
```

See [`packages/cockpit-mcp/README.md`](./packages/cockpit-mcp/README.md) for setup and configuration.

## Data

The `data/` directory contains classification rules used by the MCP server:

- `keyword-dict/` — Keyword dictionary for 19-category classification
- `exclusion-rules/` — Patterns to exclude non-classifiable transactions
- `tax-rules/` — Consumption tax rates, withholding rules, invoice system config

## License

MIT — see [LICENSE](./LICENSE) for details.

Copyright (c) 2026 Synapse Arrows PTE. LTD.
