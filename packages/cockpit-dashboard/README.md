# @kansei-link/cockpit-dashboard

L3 Web Dashboard for KanseiLink Cockpit (= paid tier、 team + customer-facing views).

## Stack

- Next.js 15.x (App Router)
- React 19
- Tailwind CSS 4
- shadcn/ui (= 順次追加)
- Supabase (Postgres + Auth + RLS + Realtime + Storage)
- Vercel JP region hosting

## Status

- 🚧 Phase 1.B Week 1 build pending (5/16-5/22)
- 現状 = scaffold + landing page のみ
- 動作確認: `pnpm install && pnpm dev` で http://localhost:3000

## Architecture

See [`../../docs/architecture.md`](../../docs/architecture.md) for the 4-layer model.

This package is L3 (= paid). L1.5 (= free MCP) is [`@kansei-link/cockpit`](../cockpit-mcp/) in the same monorepo.

## Phase 1.B Implementation schedule (= 5/16-5/22)

| Day | Task |
|---|---|
| 5/16 月 | Supabase project (JP region) + migrations apply |
| 5/17 火 | RLS policies + unit tests (= cross-org leak 検証) |
| 5/18 水 | Realtime channel publication + L2 Claude Code ↔ L3 sync test |
| 5/19 木 | Seed data + dashboard query 動作確認 + Waitlist form ライブ |
| 5/20 金 | freee/MF MCP → transactions 同期 pipeline test |
| 5/21 土 | audit_log immutable 検証 + data export/deletion flow |
| 5/22 日 | smoke test 全 green + Phase 1.B Week 2 (= UI 構築) 移行 |

## See also

- [docs/architecture.md](../../docs/architecture.md)
- [docs/db-schema-a.md](../../docs/db-schema-a.md)
- [docs/pricing.md](../../docs/pricing.md)
- [docs/storyboard-d-day-in-life.md](../../docs/storyboard-d-day-in-life.md)
