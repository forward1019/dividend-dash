# dividend-dash

Personal dividend portfolio tracker. Tracks dividend payments across brokers, projects future income with Monte Carlo simulation, scores sustainability, generates AI-powered dividend briefs, and posts a weekly Discord digest.

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
- **AI:** Anthropic Claude (10-K analysis with prompt caching)
- **Lint/format:** Biome
- **Test:** `bun test`

No frontend. No Next.js. CLI + scheduled jobs + Discord push. The "UI" is the digest.

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

# 6. Generate an AI dividend brief (requires ANTHROPIC_API_KEY)
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
| `ANTHROPIC_API_KEY` | `brief` | Claude API for AI dividend briefs |
| `DISCORD_WEBHOOK_URL` | `digest` (non-dry-run) | Where to post the weekly digest |
| `SEC_EDGAR_USER_AGENT` | EDGAR requests | SEC requires identification (any string with email works) |
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
