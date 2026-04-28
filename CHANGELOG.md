# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.6.0] — 2026-04-27

UI cleanup pass. v0.5 was dense and editorial — also too much. The home
page had five competing sections and a 60-card grid eating 80% of the
viewport. v0.6 collapses to a calmer, modern, single-scroll experience.
The DESIGN.md philosophy didn't change (still editorial finance media,
Bloomberg / Morningstar / FT references); the **execution** got quieter.

### Changed — dashboard

- **One scroll, four sections** (was five). Hero → Income outlook →
  Movers → Browse. The home page is one comfortable scroll instead of
  ten viewport-heights of cards.
- **Browse defaults to a dense table** with sticky header, sortable, and
  a TTM sparkline per row. Toggle to the old card grid via the
  List / Grid switch in the section header (preference saved in
  localStorage).
- **Universe shape** now lives as a single inline strip
  ("Mix · 20 ETFs · 40 stocks · 51 Quarterly · 9 Monthly · top sectors:
  Real Estate 8 · …") instead of three competing mini-charts.
- **Hero is editorial.** Big serif headline ("60 dividend payers,
  tracked.") sets the page, four KPI tiles below, calmer descriptive
  prose. No card-on-card noise.
- **Movers leaderboards** dropped their card borders — they're labelled
  ranked lists now, faster to scan, more "tear-sheet" than "dashboard".
- **Income outlook** condensed: the three KPI tiles, the 13-week bar
  chart, and the largest-upcoming list now share one calm section
  instead of two.

### Changed — design system

- **Dropped page-background radial gradients.** The "AI-dashboard glow"
  is gone; the page is plain `--bg`.
- **Lower-contrast surfaces.** Cards are 1–2 shades closer to bg and
  have hairline borders (8% in dark, 6% in light, was 10–18%). No
  resting box-shadow — hover is what changes.
- **Slimmer header.** Solid emerald brand mark (no gradient), no version
  pill, slightly tighter nav padding. Same shape, less noise.
- **Cyan + amber pills retired from the dashboard.** Reserved for
  per-ticker pages and warnings only. ETF/STK pills on home use
  emerald + violet.
- **More vertical rhythm.** `space-y-12` between top-level dashboard
  sections (was `space-y-7`); `space-y-6` between subsections;
  body `line-height: 1.55`.
- **Charts are flatter.** No vertical grid lines, hairline horizontal
  grid only, smaller (9–10px) tick labels, no chart-area background
  fill on bars. Single-series defaults to emerald.

### Added

- New `.ticker-table` component class for the browse list view.
- New `.kpi-bare` modifier for KPI-style numbers without a card border.
- Toggleable List / Grid view in browse, with per-user preference saved
  to localStorage.
- Leaderboard rows fall back to the category label when a ticker's
  display name is the same string as its symbol (a few ETFs lacked a
  proper `securities.name` row, so "QYLD QYLD" became "QYLD Income /
  Covered-Call ETFs"). Same fix on the browse table.

### Fixed

- Right-aligned `<th class="text-right">` headers in `.data-table` now
  actually right-align (the v0.5 CSS forced left). Calendar headers
  (Ex-date / Days / Last DPS) are now aligned with their cells.

### Migration note

No data migration. Just `bun run web` and the new design loads.
DESIGN.md bumped to v0.6 — read it before adding any new component
or page.

## [0.5.1] — universe expansion (40 → 60 tickers)

The watchlist had real coverage gaps for a dividend tracker:
zero big-cap tech dividend payers, zero financials, only three REITs,
and only one BDC/MLP. Bumped to 60 tickers across 11 categories. Full
seed runtime goes from ~12 min to ~18 min; daily refresh ~3 min → ~4–5 min.

- **New category `growth_stock`** for dividend growers with <25-year
  streaks (tech + financials). Surfaces as "Dividend growers" in the UI.
- **+5 tech div growers**: AAPL, MSFT, AVGO, TXN, CSCO.
- **+4 financial div growers**: JPM, BLK, MS, USB.
- **+5 major REITs**: AMT, PLD, EQIX, AVB, WELL.
- **+3 Dividend Kings**: CL, KMB, LOW.
- **+3 BDCs / MLPs**: ARCC, EPD, ET.
- Dashboard "Universe at a glance" subtitle is now driven by
  `totalCount` instead of a hard-coded `40`, so it stays correct as the
  list evolves.
- Updated comments, READMEs, and ops doc references from `40` to `60`
  (or removed the count entirely where the validator output already
  prints it).

### Migration note

After pulling, run `bun run seed-universe` once to backfill the 20
new tickers (20-year dividend history + quotes + fundamentals + ETF
holdings + news). Existing data is untouched (idempotent upserts).

## [0.5.0] — 2026-04-25

UI rebuild. The dashboard was honest but plain. v0.5 makes it sleek, dense,
editorial, and visibly Seeking-Alpha-flavored without copying anyone. New
design system, new dashboard sections, new ticker quote hero, new compare
scatter, new calendar income KPIs, new income simulator. Two new files
worth reading: `DESIGN.md` (the design system reference) and the rewritten
`src/web/views/layout.ts`.

### Added

**Design system (`DESIGN.md` + `layout.ts`)**
- Three-font type system: **Source Serif 4** for display headlines,
  **Inter** for UI, **JetBrains Mono** with tabular nums for every number.
- CSS-variable color tokens — light and dark sets in one place.
- Component utilities: `.kpi`, `.delta`, `.delta-pos/neg`, `.pill`,
  `.grade-A..F`, `.section-h`, `.data-table`, `.ticker-card`,
  `.anchor-ribbon`, `.range-bar`, `.news-item`, `.bar-track/-fill`.
- Refined dark and light themes — warm off-white in light, deep ink in
  dark, single-accent emerald with amber for warnings.

**Dashboard**
- Hero KPI strip with universe overview (tickers, avg yield, avg safety,
  90-day income runway).
- **Universe at a Glance** — three new charts: sector mix donut,
  yield distribution histogram, payment frequency mini-bars.
- **Income Outlook** — 30/60/90 day per-share projections with a
  13-week bar chart and a "Largest upcoming" mini-list.
- **Movers & Standouts** — Top yield / Fastest 5y growth / Longest
  streak leaderboards.
- Ticker cards now use letter-grade safety badges (A+/A/B/C/D/F) and a
  cleaner, denser layout.

**Ticker page**
- Quote-style hero: serif symbol, big mono price, pills for kind /
  category / cadence, 52-week range bar with a marker.
- **Quick Take** four-KPI strip: Forward yield, 5y CAGR, Payout (or
  Expense for ETFs), Sustainability with letter grade.
- **Sticky anchor ribbon**: Dividends · Fundamentals · Holdings (ETFs) ·
  Income simulator · News · About — auto-highlights the current section.
- **Income simulator**: type a dollar amount, see Year-1, Year-5, Year-10
  income and 10-year cumulative based on current yield + 5y CAGR.

**Compare**
- **Yield-vs-5y-Growth scatter** showing all 40 tickers with selected
  ones highlighted — the "where does this name live in the universe"
  picture.
- Default state pre-loads the top 3 by safety so the page is never blank.

**Calendar**
- 30/60/90-day per-share income KPI strip at the top.
- Month-grouped tables with subtotals and urgency pills.

### Changed

- Replaced the score ring (2-digit number) with letter grades (A+/A/B/C/D/F)
  across cards, ticker page, and compare table — closer to how investing
  publications present sustainability.
- All charts now read colors from a richer `__chartTheme()` palette
  (12-color sector wheel, semantic emerald/cyan/amber/rose).
- Header is taller, brand mark is gradient, search trigger is wider, theme
  toggle is more compact.
- Footer is simpler and properly bordered.

## [0.4.0] — 2026-04-25

Researched what makes Snowball Analytics, Sharesight, Stock Events, Seeking
Alpha, and Yahoo Finance feel slick. Stole the best ideas. The ticker
detail page is now built around real, scannable visual patterns instead of
just a wall of dividend stats.

### Added

**Rich ticker detail page**
- Hero shows exchange · sector · industry under the company name and a new
  **52-week range bar** with a marker for the current price.
- **Fundamentals panel** with 18 metric cards for stocks: P/E (TTM + Fwd),
  P/S, P/B, PEG, market cap, volume, beta, EPS, ROE, profit margin, free
  cash flow, total debt, total cash, broker dividend rate, broker yield,
  payout ratio, and ex-dividend date. ETFs see a fund-tuned variant: AUM,
  expense ratio, yield, P/E, beta, volume, YTD/3y/5y returns, fund family,
  and inception.
- **ETF holdings** section (ETF detail pages only): top-10 holdings as a
  horizontal bar list with sector-colored allocation bars. Click any
  in-universe holding to drill into it. The whole list links back to the
  fund's full holdings count.
- **Sector mix** donut chart with full legend driven by yfinance's
  `topHoldings.sectorWeightings`.
- **Latest news** feed with up to 8 items per ticker, freshness dots
  (red < 1h, amber < 6h, gray older), publisher attribution, and human
  timestamps ("3h ago"). Clicking any item opens the source page.
- Collapsed **About** section showing the company / fund description and
  homepage link, sourced from yfinance `assetProfile.longBusinessSummary`.

**Command palette (Cmd+K / Ctrl+K)**
- Sticky search button in the header opens a centered overlay palette.
- Cmd+K (or Ctrl+K, or `/`) toggles it from anywhere.
- Fuzzy ranks the universe by ticker prefix, ticker contains, name
  contains, and category match.
- ↑/↓ to navigate, ↵ to open, Esc to close. Backdrop click closes too.

**New data plumbing**
- `quote_snapshot` table captures the rich market-data picture per ticker
  per fetch (P/E, P/S, P/B, market cap, beta, EPS, FCF, ROE, debt, cash,
  fund returns, expense ratio, AUM, sector / industry, summary, website).
- `etf_holdings` and `etf_profile` tables store top-10 holdings and the
  sector breakdown JSON.
- `ticker_news` table caches the latest news per ticker, deduped by
  `(ticker, link)`. Auto-prunes anything older than 90 days on each
  insert so the table stays bounded.
- New ingest module `src/ingest/yahoo-extras.ts` fetches everything via
  `yf.quoteSummary` (price, summaryDetail, summaryProfile, assetProfile,
  defaultKeyStatistics, financialData, fundProfile, fundPerformance,
  topHoldings) plus `yf.search` for news. Tolerant of missing modules —
  ETFs, mutual funds, and foreign tickers all expose different shapes.

**New CLI surface**
- `bun run refresh-quotes` — light wrapper over
  `seed-universe -- --quotes-only`. Skips the heavy 20-year dividend
  backfill and only refreshes prices, snapshots, holdings, and news.
  Designed to be safe on a daily cron.
- `--quotes-only` and `--skip-news` flags on `seed-universe` for the same.

### Changed

- Header version badge bumped to `v0.4`.
- Schema version bumped to `2`.
- The original header search input is replaced by the command-palette
  trigger button. The `/ticker?symbol=…` redirect route is preserved for
  bookmarks / deep links.

### Internal

- 11 new unit tests in `tests/yahoo-extras.test.ts` cover snapshot upsert
  idempotency, holdings replace-on-refetch, news dedup, and the 90-day
  news pruning rule. Total: 115 passing tests.
- Research brief checked in at
  `docs/research/2026-04-25-ui-redesign-brief.md` documenting the visual
  patterns that drove this redesign.

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
