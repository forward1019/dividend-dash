# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] — 2026-04-25

Three-theme support for the web dashboard: **Light**, **Light-Dark**
(auto, follows the OS), and **Dark** (the v0.2 default look).

### Added

**Theme system**
- New segmented theme toggle (☀ / ◐ / ☾) in the header. Click to switch
  between Light, Light-Dark (auto-follow OS), and Dark.
- `light-dark` mode resolves at runtime from
  `window.matchMedia('(prefers-color-scheme: dark)')` and live-updates if
  the OS preference flips.
- Preference persisted to `localStorage` as `dd_theme`; default for new
  users is `light-dark` so the dashboard matches whatever theme the rest
  of their system uses.
- Pre-paint script in `<head>` resolves the theme attribute before first
  paint — no flash of wrong theme on load.
- `data-resolved-theme` attribute on `<html>` drives a single block of
  CSS overrides that remap the dark-first Tailwind utility classes used
  across every view, so individual views didn't need theme-aware class
  refactors.
- Chart.js color palette is theme-aware via `window.__chartTheme()`:
  axis text, gridlines, tooltip styling, and series fills all swap
  between dark and light values. Switching themes triggers a page
  reload (URL state preserved) so chart instances pick up the new
  palette cleanly.

### Changed

- Default `<html>` no longer hardcodes `class="dark"`; the pre-paint
  script sets it dynamically based on the resolved theme.
- Header version badge bumped to `v0.3`.

## [0.2.0] — 2026-04-25

A beautiful local web dashboard, plus a tracked-universe model that
preloads 40 popular dividend ETFs and stocks so the UI is interesting
even before any broker positions are imported.

### Added

**Web dashboard (`bun run web`)**
- Bun.serve HTTP server at `http://localhost:5173` (port via `DD_WEB_PORT`)
- Dark glass-morphism design with Tailwind, Inter / JetBrains Mono, Chart.js, Alpine.js (all CDN — zero npm UI deps)
- Four pages:
  - **Dashboard** — overview grid of all 40 universe tickers with sparklines, sortable + filterable by category / kind / search
  - **Ticker drill-down** (`/ticker/:symbol`) — annual + per-payment + TTM dividend charts, sustainability scorecard breakdown, recent payments table, 12-cell stat grid
  - **Compare** (`/compare?t=…`) — pick up to 6 tickers, overlay TTM dividend curves, side-by-side metric table
  - **Calendar** — 90-day projected ex-dividend calendar grouped by month
- JSON API: `GET /api/universe`, `GET /api/ticker/:t`, `GET /api/calendar`, `POST /api/refresh-cache`
- 60-second in-memory cache for analytics queries

**Tracked universe (40 tickers)**
- 20 ETFs across 5 categories: core dividend (SCHD, VYM, DVY), dividend growth (VIG, DGRO, NOBL, SDY), high-yield (SPYD, HDV, FDVV, SDIV, DIV, RDIV), income / covered-call (JEPI, JEPQ, QYLD, PFF), international (IDV, VYMI, REET)
- 20 individual stocks across 4 categories: Dividend Kings (KO, JNJ, PG, MMM, EMR), Aristocrats (PEP, MCD, WMT, ABBV, CVX, XOM, LMT), high-yield (MO, T, VZ, PFE), REITs / BDCs (O, VICI, STAG, MAIN)
- `bun run seed-universe` fetches 20 years of dividend history, latest prices, and fundamentals (payout ratio, FCF, debt/equity) for every ticker
- `bun run seed-universe -- --refresh-prices` refreshes quotes only (faster)
- `bun run seed-universe -- --ticker=SCHD,KO` for subsets

**Data layer**
- New `src/web/data.ts` accessor with cached card builder and calendar projector
- New `src/web/tickers.ts` defining the universe + categories + editorial notes
- `src/ingest/yahoo-quote.ts` fetches latest quote and fundamentals; persists to `prices` and `fundamentals` tables (previously only dividend events were ingested)

### Changed

- Upgraded `yahoo-finance2` from v2 (deprecated, broken JSON parsing) to v3.14.0
  - Constructor changed to `new YahooFinance({ suppressNotices: [...] })`
  - `quote().trailingAnnualDividendYield` and `dividendYield` now return as percentage (3.44 means 3.44%); we divide by 100 to keep our internal yield as a fraction

### Fixed

- yfinance v2 was returning HTML instead of JSON for new quote/chart calls, causing every seed attempt to fail with `SyntaxError: Failed to parse JSON`. v3 fixes it.

### Test coverage at v0.2.0

104 tests still passing (no regressions). Web layer is integration-tested
via the `/browse` skill against the live local server.

---

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
