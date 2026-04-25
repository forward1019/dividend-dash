# dividend-dash — implementation plan (locked 2026-04-25)

Six phases, optimized for fast personal value. Owner: forward1019. Built in Hermes autonomous mode.

## Phase 0 — Scaffold ✅ in progress

- [x] Create GitHub repo `forward1019/dividend-dash` (MIT, public)
- [x] Bun + TypeScript project setup (package.json, tsconfig, biome)
- [x] Directory structure (src/, tests/, scripts/, data/, docs/)
- [x] README, CLAUDE.md, plan.md, decisions.md
- [x] .env.example, .gitignore
- [ ] Initial CI workflow (bun test + type-check + biome)
- [ ] First green CI build
- [ ] Initial commit pushed to `main`

## Phase 1 — Foundation: data ingest + portfolio aggregation

**Goal:** I can run `bun run ingest` against a CSV from each broker, and `bun run report` shows my unified portfolio with current value, cost basis, and 12-month trailing dividends per holding.

- [ ] SQLite schema: `holdings`, `transactions`, `dividend_events`, `prices`, `securities` (CUSIP/ticker/SEC CIK mapping), `ingest_log`
- [ ] `src/db/migrate.ts` — apply `schema.sql` idempotently
- [ ] `src/ingest/yahoo-finance2.ts` — wrap yfinance with caching + Zod validation
- [ ] `src/ingest/sec-edgar.ts` — fetch official dividend declarations (SC 13D, 8-K) for a CIK
- [ ] `src/ingest/csv/fidelity.ts` — parse Fidelity positions/transactions CSV
- [ ] `src/ingest/csv/robinhood.ts` — parse Robinhood (likely tax doc 1099-DIV + monthly statements)
- [ ] `src/ingest/csv/ibkr.ts` — parse IBKR Flex Query CSV
- [ ] `src/ingest/csv/manual.ts` — parse a generic ticker/shares/cost_basis CSV (catches 401k)
- [ ] `src/cli/ingest.ts` — `--broker=<name> --file=<path>` dispatch
- [ ] `src/analytics/portfolio.ts` — aggregate holdings cross-broker, dedupe shares
- [ ] `src/cli/report.ts` — print plain-text portfolio summary
- [ ] Tests: parser fixtures for each broker (fake CSVs in `tests/fixtures/`)

## Phase 2 — Core analytics

**Goal:** `bun run report` shows yield, payout frequency, dividend growth rate (1y/3y/5y/10y), payout ratio, and yield-on-cost evolution per holding.

- [ ] `src/analytics/dividend-stats.ts` — frequency detection, growth CAGR, dividend coverage
- [ ] `src/analytics/yield-on-cost.ts` — historical YOC time series per lot
- [ ] `src/analytics/payout-ratio.ts` — dividend / EPS, dividend / FCF
- [ ] Tests: synthetic dividend histories (monthly, quarterly, annual, irregular)

## Phase 3 — Decision support

**Goal:** Sustainability scorecard 0-100 per holding, dividend cut early warning report.

- [ ] `src/analytics/sustainability.ts` — weighted scorecard (payout ratio, FCF cover, growth streak, debt/equity)
- [ ] `src/analytics/cut-warnings.ts` — rules engine: payout > 90%, FCF cover < 1.0, growth stalled 8+ quarters, etc.
- [ ] Surface warnings prominently in the report
- [ ] Tests: known cut-prior signals (AT&T 2022, KMI 2015, GE 2018) — verify warnings would have fired

## Phase 4 — Forward-looking

**Goal:** Forward Monte Carlo dividend income projection, personal benchmark vs SCHD/VYM/SPY.

- [ ] `src/forecast/monte-carlo.ts` — log-normal CAGR fit per holding, 10k paths, 1/5/10/20-year horizons
- [ ] `src/forecast/benchmarks.ts` — what would my $ allocation produce in SCHD/VYM/SPY?
- [ ] Output P10/P50/P90 dividend income at each horizon
- [ ] Tests: verify deterministic seed reproduces same percentiles

## Phase 5 — AI + automation

**Goal:** AI dividend brief CLI, weekly Discord digest pushed automatically.

- [ ] `src/ai/fetch-10k.ts` — pull latest 10-K from SEC EDGAR
- [ ] `src/ai/fetch-earnings-call.ts` — best-effort transcript scrape (start with Seeking Alpha free preview, fall back to Q&A snippets)
- [ ] `src/ai/brief.ts` — Claude prompt: summarize dividend health, payout policy, management guidance, recent changes; structured JSON output via Zod
- [ ] `src/cli/brief.ts` — `--ticker=SCHD` runs the brief end-to-end, prints markdown to stdout
- [ ] `src/digest/build.ts` — assemble weekly digest: top movers, cut warnings, MC update, brief highlights
- [ ] `src/digest/discord.ts` — POST to webhook (or bot+channel) with markdown + optional PNG charts
- [ ] `src/cli/digest.ts` — entrypoint
- [ ] Hermes cron: `weekly Sat 09:00 UTC → bun run digest`
- [ ] Tests: digest builder snapshot test with fixture portfolio

## Phase 6 — Ship & polish

- [ ] CI: bun install + type-check + biome + test on push to main and PRs
- [ ] README screenshots / GIF of the digest
- [ ] First real run against owner's actual portfolio (HITL — owner provides CSVs)
- [ ] First real digest posted to Discord
- [ ] Tag v0.1.0
- [ ] Post-ship summary back to #coding/dividend-tracker thread with GitHub URL, screenshots, what got cut, what to iterate next

## Reversible defaults already chosen (revisit later)

See `docs/decisions.md` for full rationale on each.

- Sustainability scorecard weights: payout ratio 35%, FCF cover 35%, growth streak 20%, debt/equity 10%
- Monte Carlo distribution: log-normal fit on 10-year dividend CAGR
- Digest format: markdown + inline PNG charts via simple lib, posted via webhook
- Database: single SQLite file at `./data/dividend-dash.db`, no migrations framework yet — straight `schema.sql`
- LLM: claude-opus-4-7 for the brief (highest quality, cost is negligible for ~30 holdings/week)
