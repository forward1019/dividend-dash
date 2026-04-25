# dividend-dash — implementation plan (locked 2026-04-25)

Six phases, optimized for fast personal value. Owner: forward1019. Built in Hermes autonomous mode.

## Phase 0 — Scaffold ✅ done

- [x] Create GitHub repo `forward1019/dividend-dash` (MIT, public)
- [x] Bun + TypeScript project setup (package.json, tsconfig, biome)
- [x] Directory structure (src/, tests/, scripts/, data/, docs/)
- [x] README, CLAUDE.md, plan.md, decisions.md
- [x] .env.example, .gitignore
- [x] Initial CI workflow (bun test + type-check + biome)
- [x] First green CI build
- [x] Initial commit pushed to `main`

## Phase 1 — Foundation: data ingest + portfolio aggregation ✅ done

**Goal:** I can run `bun run ingest` against a CSV, and `bun run report` shows my unified portfolio.

- [x] SQLite schema: `holdings`, `transactions`, `dividend_events`, `prices`, `securities`, `fundamentals`, `ingest_log`
- [x] `src/db/migrate.ts` — apply `schema.sql` idempotently
- [x] `src/ingest/yahoo-finance.ts` — wrap yfinance with Zod validation
- [x] `src/ingest/sec-edgar.ts` — ticker → CIK resolution + filings index
- [x] `src/ingest/csv/fidelity.ts` — parse Fidelity Positions CSV
- [x] `src/ingest/csv/manual.ts` — generic parser (covers 401k, robinhood, ibkr)
- [ ] Dedicated robinhood / ibkr parsers — deferred; manual parser handles typical exports
- [x] `src/cli/ingest.ts` — `--broker=<name> --file=<path>` dispatch with SHA-256 audit
- [x] `src/analytics/portfolio.ts` — cross-broker aggregation
- [x] `src/cli/report.ts` — plain-text portfolio summary
- [x] Tests: parser fixtures + idempotency on re-import

## Phase 2 — Core analytics ✅ done

- [x] `src/analytics/dividend-stats.ts` — frequency detection, CAGR, growth streaks, forward/trailing yield
- [x] `src/analytics/yield-on-cost.ts` — quarterly YOC time series
- [x] `src/analytics/portfolio.ts` — TTM dividend rollups
- [x] Tests: synthetic histories (monthly, quarterly, annual, growth streaks, decreases)
- [ ] `src/analytics/payout-ratio.ts` — folded into `sustainability.ts` instead

## Phase 3 — Decision support ✅ done

- [x] `src/analytics/sustainability.ts` — weighted scorecard (35/35/20/10)
- [x] `src/analytics/cut-warnings.ts` — 7 rules engine across red/amber/yellow severities
- [x] Warnings surfaced in digest's "⚠️ Cut early warnings" section
- [x] Tests: AT&T 2022, GE 2018, flat-8y, levered-high-payout, decelerating growth

## Phase 4 — Forward-looking ✅ done

- [x] `src/forecast/monte-carlo.ts` — log-normal CAGR fit + 10k paths default
- [x] `src/forecast/benchmarks.ts` — SCHD/VYM/SPY allocation comparison
- [x] P10/P50/P90/mean output at each horizon year
- [x] Tests: deterministic seed, multi-holding scaling, growth clamp, monotone percentiles

## Phase 5 — AI + automation ✅ done

- [x] `src/ai/fetch-10k.ts` — SEC EDGAR latest 10-K retrieval
- [x] `src/ai/brief.ts` — Claude (opus-4-7) with prompt caching, Zod-validated JSON
- [x] `src/cli/brief.ts` — CLI entrypoint with optional `--earnings-file` flag
- [x] `src/digest/build.ts` — multi-section digest builder
- [x] `src/digest/discord.ts` — webhook poster with safe splitting
- [x] `src/cli/digest.ts` — entrypoint with `--dry-run` and `--no-mc` flags
- [x] Tests: digest builder integration test with seeded DB
- [ ] `src/ai/fetch-earnings-call.ts` — deferred; brief accepts manual `--earnings-file`
- [ ] Hermes cron wiring — left to user's preferred scheduler (one-shot `bun run digest` works)

## Phase 6 — Ship & polish ✅ done

- [x] CI: bun install + type-check + biome + test on push to main and PRs (green from first push)
- [x] README with sample digest, badges, scripts table, config table
- [x] CHANGELOG.md
- [x] Tag v0.1.0
- [x] Post-ship summary back to #coding/dividend-tracker thread
- [ ] First real run against owner's actual portfolio (HITL — owner provides CSVs when ready)
- [ ] First real digest posted to Discord (gated on owner setting `DISCORD_WEBHOOK_URL` and ingesting holdings)

## Reversible defaults already chosen (revisit later)

See `docs/decisions.md` for full rationale on each.

- Sustainability scorecard weights: payout ratio 35%, FCF cover 35%, growth streak 20%, debt/equity 10%
- Monte Carlo distribution: log-normal fit on 10-year dividend CAGR
- Digest format: markdown + inline PNG charts via simple lib, posted via webhook
- Database: single SQLite file at `./data/dividend-dash.db`, no migrations framework yet — straight `schema.sql`
- LLM: claude-opus-4-7 for the brief (highest quality, cost is negligible for ~30 holdings/week)
