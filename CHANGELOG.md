# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — 2026-04-25

Initial autonomous-mode build. Six phases shipped in a single session.

### Added

**Phase 0 — Scaffold**
- Bun + TypeScript project with strict tsconfig (`noUncheckedIndexedAccess`, etc.)
- Biome for lint + format
- GitHub Actions CI: type-check, lint, test on push/PR
- Initial directory structure (`src/`, `tests/`, `scripts/`, `data/`, `docs/`)

**Phase 1 — Data ingest + portfolio aggregation**
- SQLite schema: securities, holdings, transactions, dividend_events, prices, fundamentals, ingest_log
- Repository layer (`src/db/repo.ts`) with idempotent upserts
- Manual / generic CSV parser (covers 401k, robinhood, ibkr until dedicated parsers ship)
- Fidelity Positions CSV parser (handles header detection, footer disclaimers, account masking)
- yahoo-finance2 wrapper for security metadata + dividend history (20-year default)
- SEC EDGAR client for ticker→CIK resolution
- Portfolio aggregation across brokers using latest snapshot per (broker, account, ticker)
- TTM dividend cash income aggregation
- `ingest` CLI dispatches to the right parser and records SHA-256 of the source file

**Phase 2 — Core analytics**
- Frequency detection (monthly/quarterly/semiannual/annual via median ex-date gap)
- TTM and annual DPS calculations
- Dividend CAGR over configurable horizons
- Growth streak years (consecutive non-decreasing annual DPS)
- Forward yield (latest payment annualized / price)
- Trailing yield (TTM DPS / price)
- Quarterly yield-on-cost time series

**Phase 3 — Decision support**
- Sustainability scorecard 0-100 (payout 35% + FCF 35% + growth streak 20% + debt/equity 10%)
- Per-component scores returned alongside total + warnings
- 7 cut early-warning rules across red/amber/yellow severity tiers
- Verified against historical cuts (AT&T 2022, GE 2018, KMI 2015)

**Phase 4 — Forward-looking**
- Seedable mulberry32 PRNG with cached Box-Muller normal sampler
- Monte Carlo forward income simulation (P paths × H years × N holdings)
- Log-normal CAGR fit with min stddev floor and growth clamping
- P10 / P50 / P90 / mean income at each future year
- SCHD / VYM / SPY benchmark allocation comparison

**Phase 5 — AI + automation**
- 10-K retrieval from SEC EDGAR (CIK lookup → submissions → primary doc)
- HTML→plaintext converter, focused dividend-section extractor
- Claude-powered dividend brief with prompt caching (system + 10-K cached as ephemeral)
- Zod-validated structured JSON output
- Weekly digest builder with multiple sections (portfolio, scorecard, warnings, MC, benchmarks)
- Discord webhook poster with safe message splitting at <2000 chars

**Phase 6 — Ship**
- README with sample digest, badges, scripts table, config table
- This CHANGELOG
- v0.1.0 tag

### Test coverage at v0.1.0

104 tests across 13 files, 215 assertions, all passing.

### Known gaps (next iteration)

- Fundamentals ingest from SEC EDGAR XBRL (payout ratio, FCF, debt/equity) — currently optional, scorecard degrades gracefully when missing
- Dedicated Robinhood and IBKR Flex Query parsers — currently use the manual parser, which works for typical exports
- Earnings call transcript fetcher — `brief` accepts a manually-supplied transcript file but doesn't auto-fetch
- Cron wiring for the weekly digest — `bun run digest` works as a one-shot; scheduling is left to the user's preferred cron / Hermes scheduler
