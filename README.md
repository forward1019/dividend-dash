# dividend-dash

Personal dividend portfolio tracker. Tracks dividend payments across brokers, projects future income with Monte Carlo simulation, scores sustainability, generates AI-powered dividend briefs, and posts a weekly Discord digest.

> Built for myself. Public because it might be useful to others. Not financial advice.

## Why this exists

Existing dividend trackers (Snowball, Sharesight, Stock Events, broker dashboards) are fine for "what did I get paid last quarter" but they all stop short of:

- **Forward Monte Carlo** — what's my dividend income in 5/10/20 years across plausible CAGR distributions, not a single deterministic line?
- **Sustainability scorecard** — a single 0-100 number per holding combining payout ratio, FCF cover, and dividend growth streak so I can see fragile payers at a glance.
- **Cut early warnings** — flags when payout ratio crosses thresholds, FCF turns negative, or growth stalls before the cut hits.
- **Cross-broker truth** — Robinhood + Fidelity + IBKR + 401(k) reconciled into one portfolio.
- **AI dividend brief** — Claude reads the latest 10-K and earnings call transcript and tells me whether the dividend story changed.
- **Weekly Discord digest** — pushed to me, not pulled.

## Stack

- **Runtime:** Bun 1.1+
- **Language:** TypeScript 5.7
- **Database:** SQLite (via `bun:sqlite`)
- **Data sources:** [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) (free, 20+ years of dividend history), SEC EDGAR (free, official filings), [Polygon.io](https://polygon.io) ($29/mo) as paid fallback only.
- **AI:** Anthropic Claude (10-K + earnings call analysis)
- **Lint/format:** Biome
- **Test:** `bun test`

No frontend framework, no Next.js, no React. CLI + scheduled jobs + Discord push. The "UI" is the digest.

## Status

**Phase 0 (scaffold)** — in progress.

See [`docs/plan.md`](docs/plan.md) for the full 6-phase roadmap and [`docs/decisions.md`](docs/decisions.md) for autonomous-mode judgment calls and their rationale.

## Quick start

```bash
# Install
bun install

# Initialize the database
bun run migrate

# Import a holdings CSV from your broker
bun run ingest -- --broker=fidelity --file=./fidelity-positions.csv

# Run analytics report
bun run report

# Generate AI dividend brief for a ticker (requires ANTHROPIC_API_KEY)
bun run brief -- --ticker=SCHD

# Generate the weekly digest (will not post without DISCORD_WEBHOOK_URL)
bun run digest
```

Copy `.env.example` to `.env` and fill in keys you need.

## License

MIT — see [LICENSE](LICENSE).
