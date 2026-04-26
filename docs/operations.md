# Operations

How dividend-dash stays fresh and how to verify it's still working.

## Data freshness

Prices, dividend events, and quote snapshots are end-of-day only — yfinance free is not real-time, and a daily-resolution dashboard doesn't need it to be. Two refresh modes ship with the repo:

- `bun run seed-universe` — full backfill: 20-year dividend history, latest quote, fundamentals, ETF holdings, news, then Stooq cross-validation. ~12 min wall clock.
- `bun run refresh-quotes` — fast path: 90-day dividend window + quote + snapshot + holdings + news + Stooq cross-validation. ~3 min wall clock.

The 90-day window in `refresh-quotes` is idempotent because `dividend_events` has a `UNIQUE(ticker, ex_date, source)` constraint — re-fetching pre-existing rows costs an `ON CONFLICT DO UPDATE` per ticker.

## Hermes cron schedule

Two cron jobs live in `~/.hermes/cron/jobs.json` (set up via `mcp_cronjob` actions, not in-repo).

### Daily refresh

```
job_id:    8088f5482100
schedule:  0 1 * * 2-6   (01:00 Pacific, Tue–Sat → captures Mon–Fri EOD)
command:   bun run refresh-quotes
deliver:   local         (silent on success → ~/.hermes/cron/output/)
```

Why 01:00 PT and not 17:00 PT (right after market close)? Yahoo's after-hours adjustments and the Stooq mirror's overnight refresh both settle by midnight Eastern. Fetching at 01:00 PT (= 04:00 ET) gets the cleanest EOD bars without racing either source.

The cron's prompt is self-contained — it can run from a fresh agent session with no prior context. It parses the script's stdout for `Done. N ok, M failed.` and `Validation: N/M agree with Stooq` and emits a one-line success summary or a multi-line anomaly report.

### Weekly full reseed

```
job_id:    f7795197b6e4
schedule:  0 8 * * 6     (Saturday 08:00 Pacific, market closed for the weekend)
command:   bun run seed-universe
deliver:   local
```

Catches retroactive Yahoo corrections (Yahoo occasionally re-issues historical dividend rows after the fact). The 90-day window in the daily refresh would miss anything older than that.

## Verifying the data is fresh

```bash
bun run -e "
import { Database } from 'bun:sqlite';
const db = new Database('data/dividend-dash.db');
console.log('Latest prices:');
console.log(db.query(\`
  SELECT MAX(date) AS latest, COUNT(DISTINCT ticker) AS tickers
  FROM prices
\`).get());
console.log('Latest fetch:');
console.log(db.query(\`
  SELECT MAX(fetched_at) AS latest_fetch, COUNT(*) AS snapshots
  FROM quote_snapshot
\`).get());
"
```

Expected: `latest_date` is the most recent trading-day close (yesterday on weekdays, last Friday on weekends), `latest_fetch` is within ~24 hours of now.

If `latest_date` is stale by more than 1 trading day, check `~/.hermes/cron/output/dividend-dash-refresh-*.log` for the anomaly report. The most common cause is a Yahoo rate-limit ban that lifts within a few hours.

## Cross-source validation

Every refresh runs a Yahoo↔Stooq price cross-check (`src/ingest/stooq.ts`). The check fails loud when:

- Yahoo's stored close differs from Stooq's same-day close by more than 1% (`price-diverged`)
- Stooq has a different bar date than Yahoo's stored bar (`date-mismatch` — usually means Yahoo's refresh failed silently for that ticker)
- Stooq returns N/D for a ticker (`missing-source` — Stooq doesn't cover it)
- Our DB has no Yahoo price for a ticker we tried to validate (`no-yahoo`)

Baseline expectation: every universe ticker agrees with Stooq to the cent. The validator prints `agree/total` so any deviation surfaces as a numeric drop in the headline. Any real divergence is news, not a false alarm.

## Manual operations

```bash
# Force-refresh a single ticker (e.g. after seeing a divergence in the cron output)
bun run seed-universe -- --ticker=KO

# Refresh prices/quotes for a subset without paying the 20y dividend cost
bun run refresh-quotes -- --ticker=SCHD,VYM,KO

# Skip the news fetch (offline / sandboxed scenarios)
bun run seed-universe -- --skip-news

# Skip the Stooq cross-check (fastest possible refresh)
bun run refresh-quotes -- --skip-validation
```

## Known caveats

- **Yahoo's `trailingAnnualDividendRate` ≠ our recomputed TTM** — Yahoo sometimes adds a phantom payment or excludes one. Our analytics layer always recomputes TTM from raw events, which is more reliable.
- **Special dividends** are detected by an anchor-cohort classifier (see `src/analytics/dividend-stats.ts`). The classifier needs ≥6 events to fire and is conservative — it prefers false negatives (missing a real special) over false positives (mis-tagging a regular raise).
- **REIT/BDC payout ratios** from Yahoo are based on GAAP EPS, which is structurally wrong for these issuer types. The sustainability scorer detects them via the `securityKind` discriminator and disables the GAAP-payout component. The right metrics are AFFO (REITs) and NII (BDCs), which currently aren't pulled — see the EDGAR XBRL deferred follow-up.
