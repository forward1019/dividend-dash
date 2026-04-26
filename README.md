# dividend-dash

Personal dividend portfolio tracker. Tracks dividend payments across brokers, projects future income with Monte Carlo simulation, scores sustainability, generates AI-powered dividend briefs, posts a weekly Discord digest, and ships with a local web dashboard pre-loaded with 40 popular dividend ETFs and stocks. **New in v0.4:** rich ticker detail pages with fundamentals (P/E, P/S, market cap, beta, FCF…), ETF holdings + sector mix, news feed with freshness markers, and a Cmd+K command palette.

[![CI](https://github.com/forward1019/dividend-dash/actions/workflows/ci.yml/badge.svg)](https://github.com/forward1019/dividend-dash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Built for myself. Public because it might be useful to others. Not financial advice.

## Why this exists

Existing dividend trackers (Snowball, Sharesight, Stock Events, broker dashboards) are fine for "what did I get paid last quarter" but they all stop short of:

- **Forward Monte Carlo** — what's my dividend income in 5/10/20 years across plausible CAGR distributions, not a single deterministic line?
- **Sustainability scorecard** — a single 0-100 number per holding combining payout ratio, FCF cover, and dividend growth streak so I can see fragile payers at a glance.
- **Cut early warnings** — flags when payout ratio crosses thresholds, FCF turns negative, or growth stalls before the cut hits.
- **Cross-broker truth** — Robinhood + Fidelity + IBKR + 401(k) reconciled into one portfolio.
- **AI dividend brief** — Claude reads the latest 10-K and tells me whether the dividend story changed.
- **Weekly Discord digest** — pushed to me, not pulled.

## Stack

- **Runtime:** Bun 1.1+
- **Language:** TypeScript 5.9 (strict)
- **Database:** SQLite via `bun:sqlite`
- **Data sources:** [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) (free, 20+ years of dividend history), SEC EDGAR (free, official filings), [Polygon.io](https://polygon.io) ($29/mo) as paid fallback only.
- **AI:** Anthropic Claude via local `claude` CLI (Claude Max OAuth by default, prompt caching automatic; falls back to `ANTHROPIC_API_KEY` if set)
- **Lint/format:** Biome
- **Test:** `bun test`

Frontend: **`Bun.serve` web dashboard** (added in v0.2). Tailwind + Chart.js + Alpine.js, all CDN — no npm UI deps. CLI + scheduled jobs + Discord push are still first-class; the web UI is for browsing the universe and drilling in.

## Web dashboard

```bash
bun run migrate          # one-time
bun run seed-universe    # fetches 20y dividends, prices, fundamentals for 40 popular tickers
bun run web              # http://localhost:5173
```

Four pages:

- **Dashboard** — searchable, sortable, filterable grid of all 40 universe tickers with sparklines, forward yield, sustainability score, growth streak, 5y CAGR
- **Ticker drill-down** (`/ticker/SCHD`) — hero with 52-week range bar, dividend stat grid, annual / per-payment / TTM dividend charts, sustainability scorecard breakdown, **fundamentals panel (v0.4)** with P/E / P/S / P/B / PEG / market cap / beta / EPS / ROE / FCF / debt / cash, **ETF holdings list + sector donut (v0.4)** for ETFs, **latest news feed with freshness markers (v0.4)**, and a collapsed company/fund summary
- **Compare** (`/compare?t=SCHD&t=VYM&t=VIG`) — overlay TTM dividend curves for up to 6 tickers, side-by-side metric table
- **Calendar** — 90-day projected ex-dividend calendar grouped by month

Press **⌘K** (or Ctrl+K, or `/`) anywhere to open the command palette and jump to any ticker in two keystrokes.

The 40-ticker universe spans Dividend Kings (KO, JNJ, PG, MMM, EMR), Aristocrats (PEP, MCD, WMT, ABBV, CVX, XOM, LMT), high-yield stocks (MO, T, VZ, PFE), REITs / BDCs (O, VICI, STAG, MAIN), and 20 popular dividend ETFs across core (SCHD, VYM, DVY), growth (VIG, DGRO, NOBL, SDY), high-yield (SPYD, HDV, FDVV, SDIV, DIV, RDIV), income / covered-call (JEPI, JEPQ, QYLD, PFF), and international (IDV, VYMI, REET) categories. Edit `src/web/tickers.ts` to add or remove tickers, then re-run `bun run seed-universe`.

### Refreshing data

```bash
bun run seed-universe   # full backfill: 20y dividends + quotes + snapshots + holdings + news
bun run refresh-quotes  # light: skip dividend backfill, refresh just quotes/snapshots/holdings/news (cron-friendly)
```

JSON API: `GET /api/universe`, `GET /api/ticker/:t`, `GET /api/calendar`.

## Quick start

```bash
# 1. Install
bun install

# 2. Initialize the database
bun run migrate

# 3. Import a holdings CSV
bun run ingest -- --broker=manual --file=./positions.csv
# or for Fidelity exports
bun run ingest -- --broker=fidelity --file=./fidelity-positions.csv

# 4. View the portfolio report
bun run report

# 5. Generate the weekly digest (dry run prints to stdout)
bun run digest -- --dry-run

# 6. Generate an AI dividend brief
#    (uses the local `claude` CLI / your Claude Max OAuth — no API key needed.
#     Set ANTHROPIC_API_KEY only if you want to use an API account instead.)
bun run brief -- --ticker=SCHD
```

Copy `.env.example` to `.env` and fill in the keys you want.

## Sample digest output

```markdown
# 📊 dividend-dash weekly digest — 2026-04-25

**Portfolio:** $25650.00 cost basis · 3 positions across 1 broker(s)
**TTM dividend income:** $920.00 (3.59% YOC)

## 💰 Top dividend earners (TTM)

| Ticker | TTM Income | Payments |
|--------|-----------:|---------:|
| SCHD   | $415.00    | 4        |
| VYM    | $290.00    | 4        |
| JNJ    | $215.00    | 4        |

## 🛡️ Sustainability scorecard

| Ticker | Score | Top warnings |
|--------|------:|--------------|
| SCHD   | 86.2  | —            |
| VYM    | 84.0  | —            |
| JNJ    | 91.8  | —            |

## ⚠️ Cut early warnings
*(empty — all clear this week)*

## 🔮 Forward dividend income (Monte Carlo, 5000 paths)

| Year | P10  | P50   | P90    |
|----:|-----:|-----:|------:|
| 1   | $952 | $972  | $993   |
| 5   | $1124| $1213 | $1308  |
| 10  | $1413| $1640 | $1903  |
| 20  | $2230| $3024 | $4109  |

## 🎯 Benchmark vs your portfolio (20y projection)

| Benchmark   | Today | P50 @ 20y | P90 @ 20y |
|------------|------:|---------:|---------:|
| SCHD       | $949  | $7128    | $11820   |
| VYM        | $743  | $2381    | $3398    |
| SPY        | $333  | $1054    | $1502    |
| **You**    | **$920** | **$3024** | **$4109** |
```

## Project layout

```
src/
  cli/        # ingest, report, digest, brief, migrate
  db/         # schema.sql, db.ts, repo.ts (idempotent upserts)
  ingest/
    csv/      # fidelity, manual (covers 401k/robinhood/ibkr)
    yahoo-finance.ts
    sec-edgar.ts
  analytics/
    portfolio.ts          # cross-broker rollup
    dividend-stats.ts     # frequency, CAGR, growth streaks, yields
    yield-on-cost.ts      # quarterly YOC time series
    sustainability.ts     # 0-100 scorecard
    cut-warnings.ts       # 7 early-warning rules
  forecast/
    monte-carlo.ts        # log-normal CAGR fit, 10k paths
    benchmarks.ts         # SCHD/VYM/SPY comparison
    random.ts             # seedable PRNG
  ai/
    fetch-10k.ts          # SEC EDGAR 10-K retrieval
    brief.ts              # Claude-powered structured analysis
  digest/
    build.ts              # markdown digest builder
    discord.ts            # webhook poster with safe splitting
  lib/                    # config, logger, money utilities
  types.ts                # Zod schemas
tests/                    # 100+ tests, all bun test
docs/
  plan.md                 # 6-phase roadmap
  decisions.md            # autonomous-mode judgment calls
```

## Scripts

| Command | What it does |
|---|---|
| `bun run migrate` | Apply `src/db/schema.sql` to the DB |
| `bun run seed-universe` | Fetch dividends + prices + fundamentals for the 40-ticker universe |
| `bun run seed-universe -- --refresh-prices` | Refresh quotes only (faster, no dividend re-fetch) |
| `bun run seed-universe -- --ticker=SCHD,KO` | Seed/refresh a subset |
| `bun run web` | Start the local web dashboard (default port 5173, override with `DD_WEB_PORT`) |
| `bun run ingest -- --broker=<name> --file=<path>` | Import a broker CSV |
| `bun run report` | Print portfolio summary to stdout |
| `bun run brief -- --ticker=<TICKER>` | AI dividend brief from latest 10-K |
| `bun run digest [-- --dry-run]` | Build & post weekly Discord digest |
| `bun test` | Run the test suite |
| `bun run type-check` | `tsc --noEmit` |
| `bun run lint` / `lint:fix` | Biome lint + format |

## Config

Set these in `.env` (see `.env.example`):

| Var | Required for | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | optional | Only needed for `brief` if you don't have a local `claude` CLI with Max OAuth (default path uses the CLI) |
| `CLAUDE_BIN` | optional | Path to the `claude` binary if not on `$PATH` (default: `claude`) |
| `DISCORD_WEBHOOK_URL` | `digest` (non-dry-run) | Where to post the weekly digest |
| `SEC_EDGAR_USER_AGENT` | EDGAR requests | SEC fair-access policy. Format: `"Your Name your@real-email.com"`. ⚠️ Generic / no-reply domains (e.g. `users.noreply.github.com`) are blocked by SEC's bot detector — use a real personal or company email. |
| `POLYGON_API_KEY` | optional fallback | Used only if free sources fail |
| `DD_DB_PATH` | optional | Override DB location (default: `./data/dividend-dash.db`) |
| `DD_LOG_LEVEL` | optional | `debug` / `info` / `warn` / `error` |

## How it was built

This repo was built in a single session in **Hermes autonomous mode** on 2026-04-25.

- 6 phases (scaffold → ingest → analytics → decision → forecast → AI/automation), see [`docs/plan.md`](docs/plan.md)
- Reversible defaults documented in [`docs/decisions.md`](docs/decisions.md)
- Tests for every public function (104 tests, no mocks for unit-pure logic)
- Cut-detection rules verified against historical cuts (AT&T 2022, GE 2018, KMI 2015)

## License

MIT — see [LICENSE](LICENSE).
