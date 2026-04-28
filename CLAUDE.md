# dividend-dash — agent guide

This file is for AI agents (Claude Code, Hermes, Codex) working on this repo. Read it first.

## Project context

Personal dividend portfolio tracker for **forward1019**. Not a startup, not commercial. Built fast, optimized for the owner's actual usage. Features that don't get used should be removed, not maintained.

Owner won't pay for SaaS dividend trackers, so this is the fix-it-yourself version. See [`docs/plan.md`](docs/plan.md) for the locked 6-phase plan and [`docs/decisions.md`](docs/decisions.md) for judgment calls made during autonomous execution.

## Stack & conventions

- **Bun + TypeScript** — same as `agent-scout` and `wheel-bot`. Use `bun:sqlite`, not `better-sqlite3`. Use `Bun.file()` and `Bun.write()` for file IO when reasonable.
- **No frameworks** — no Next.js, no React, no Express. CLI scripts + cron + Discord webhook push. The output is a weekly Discord digest, not a web app.
- **Strict TypeScript** — `strict: true`, `noUncheckedIndexedAccess: true`. No `any` unless commented why.
- **Zod at every external boundary** — broker CSV imports, yahoo-finance2 responses, SEC EDGAR JSON, LLM outputs.
- **SQLite is the source of truth** — all imports flow into the DB. Reports query the DB. The DB lives at `./data/dividend-dash.db` by default (gitignored).
- **Free-first data** — yahoo-finance2 + SEC EDGAR are the primary sources. Polygon.io is a paid fallback only if free sources break, gated by `POLYGON_API_KEY`.

## Common commands

```bash
bun install                # install deps
bun run migrate            # apply DB schema
bun run dev                # main entrypoint (placeholder until Phase 1)
bun run ingest -- --broker=fidelity --file=./positions.csv
bun run report             # print analytics to stdout
bun run brief -- --ticker=SCHD   # AI dividend brief
bun run digest             # weekly Discord digest
bun test                   # run tests
bun run type-check         # tsc --noEmit
bun run lint               # biome check
bun run lint:fix           # biome check --write
```

## Directory layout

```
src/
  cli/          # entry points: ingest, report, digest, brief, migrate, seed
  db/           # schema.sql, db.ts (singleton), migrate.ts
  ingest/       # broker CSV parsers, yahoo-finance2 client, SEC EDGAR client
  analytics/    # dividend stats, yield-on-cost, sustainability scorecard
  forecast/     # Monte Carlo simulation, benchmarking
  ai/           # Claude-powered dividend brief
  digest/       # weekly Discord digest builder + sender
  lib/          # shared utilities (logger, config, dates)
  types.ts      # shared types
tests/          # bun test suites (unit + integration)
scripts/        # one-off ops scripts
data/           # SQLite DB + CSV imports (gitignored except .gitkeep)
docs/           # plan.md, decisions.md, ARCHITECTURE.md
```

## Conventions specific to this repo

- **Money is integer cents.** Never store currency as float. Use `bigint` for cents-of-USD if values may exceed JS safe integer range.
- **Dates are ISO-8601 strings (`YYYY-MM-DD`)** in the DB, parsed to `Date` only at the boundary.
- **Tickers are uppercase, broker-normalized.** A holding's primary key is `(broker, account, ticker)`, not just ticker.
- **All long-running scripts are idempotent.** Re-running `bun run ingest` against the same file should be a no-op or an upsert, never a duplicate.
- **No real-time price polling.** End-of-day data is sufficient for dividend analysis. Cache yahoo-finance2 responses to SQLite to be a polite citizen.

## Things to NOT do

- Don't add user accounts, multi-tenancy, or auth. Single-user tool.
- Don't pull in heavy charting libs server-side. The web UI uses Chart.js
  client-side via CDN; the digest stays text/markdown.
- Don't add real-time price streaming. EOD via `bun run refresh-quotes`.
- Don't store API keys in code. `.env` only. Validate presence at startup.

## Web UI conventions (v0.6+)

There IS a web UI now (`bun run web` → http://localhost:5173). It's the
primary surface. The weekly digest is the secondary surface.

- All design tokens, fonts, and component CSS live in
  `src/web/views/layout.ts`. Read **DESIGN.md** (v0.6) before touching
  the UI.
- Use the existing utility classes (`.kpi`, `.kpi-bare`, `.delta`,
  `.pill`, `.grade-X`, `.section-h`, `.data-table`, `.ticker-table`,
  `.ticker-card`). If you need a new component, add it to `layout.ts`
  so the system stays coherent — do not one-off it inside a view.
- All numeric values use `.num` (tabular nums on, JetBrains Mono).
- Charts read colors from `window.__chartTheme()` so they adapt to dark /
  light. Don't hardcode `#34d399` etc. inside a view.
- The dashboard browse defaults to **list view** (a `.ticker-table`).
  Grid view (the v0.5 card grid) is the toggle. Don't add new sections
  to the dashboard without thinking hard about whether they belong on
  /compare or /calendar instead — the home page is intentionally lean.

## Autonomous mode notes

This project is being built in Hermes autonomous mode. The agent operating it should:

1. Make irreversible decisions only with explicit user approval. Reversible defaults: pick one, document in `docs/decisions.md`, move on.
2. Commit small, atomic changes per logical step. Push frequently.
3. Update `docs/plan.md` task statuses as they complete.
4. End each turn cleanly per the Hermes autonomous-mode protocol — either keep working in the same turn, arm a `notify_on_complete` watcher, or save state to `tasks/resume-<timestamp>.md` and arm a cron.

## Owner

GitHub: [forward1019](https://github.com/forward1019). Discord: `forward05709`.
