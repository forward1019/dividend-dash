/**
 * One-shot seed for the dividend universe (40 popular ETFs + stocks).
 *
 * For each ticker:
 *   1. Upsert security metadata (name, sector, industry, exchange)
 *   2. Fetch and upsert 20 years of dividend history from yfinance
 *   3. Fetch and upsert latest quote price
 *   4. Fetch and upsert fundamentals (payout ratio, FCF, debt) — best effort
 *
 * Safe to re-run; uses ON CONFLICT upserts everywhere.
 *
 *   bun run seed-universe                      # all 40 tickers
 *   bun run seed-universe -- --ticker=SCHD,KO  # subset
 *   bun run seed-universe -- --refresh-prices  # quotes + fundamentals only
 */

import { Database } from 'bun:sqlite';

import { validateUniverseAgainstStooq } from '../ingest/stooq.ts';
import {
  fetchEtfHoldings,
  fetchQuoteSnapshot,
  fetchTickerNews,
  upsertEtfHoldings,
  upsertNews,
  upsertQuoteSnapshot,
} from '../ingest/yahoo-extras.ts';
import { fetchAndUpsertDividends, fetchAndUpsertSecurity } from '../ingest/yahoo-finance.ts';
import {
  fetchFundamentals,
  fetchLatestQuote,
  upsertFundamentals,
  upsertLatestPrice,
} from '../ingest/yahoo-quote.ts';
import { config } from '../lib/config.ts';
import { log } from '../lib/logger.ts';
import { DIVIDEND_UNIVERSE, getTicker } from '../web/tickers.ts';

interface CliArgs {
  tickers: string[];
  refreshPricesOnly: boolean;
  /**
   * When true, skip the heavy 20-year dividend backfill and ONLY refresh:
   *   - latest quote price
   *   - rich quote snapshot (P/E, P/S, market cap, etc.)
   *   - ETF holdings (when applicable)
   *   - latest news
   * Designed to be safe to run on a daily cron without burning yfinance
   * rate limits.
   */
  quotesOnly: boolean;
  /** Skip fetching news entirely (for offline/testing scenarios). */
  skipNews: boolean;
  /**
   * Skip the post-fetch Stooq cross-validation. Off by default — the
   * validation is cheap (~10s for 40 tickers) and surfaces real
   * Yahoo-vs-reality drift the moment it happens.
   */
  skipValidation: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    tickers: [],
    refreshPricesOnly: false,
    quotesOnly: false,
    skipNews: false,
    skipValidation: false,
  };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--ticker=')) {
      args.tickers = a
        .slice('--ticker='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (a === '--refresh-prices') {
      args.refreshPricesOnly = true;
    } else if (a === '--quotes-only') {
      args.quotesOnly = true;
    } else if (a === '--skip-news') {
      args.skipNews = true;
    } else if (a === '--skip-validation') {
      args.skipValidation = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const db = new Database(config.dbPath, { create: true });

  // Subset by ticker if requested, otherwise the full universe.
  const targets =
    args.tickers.length > 0
      ? args.tickers.map((t) => ({
          ticker: t,
          fallbackName: getTicker(t)?.name ?? t,
        }))
      : DIVIDEND_UNIVERSE.map((u) => ({ ticker: u.ticker, fallbackName: u.name }));

  log.info(`Seeding ${targets.length} tickers (refresh_prices_only=${args.refreshPricesOnly})`);

  let ok = 0;
  let failed = 0;

  for (const t of targets) {
    const ticker = t.ticker;
    const isEtf = (() => {
      const u = getTicker(ticker);
      return u?.kind === 'etf';
    })();
    try {
      // 1. Security metadata (always)
      log.info(`[${ticker}] fetching metadata`);
      await fetchAndUpsertSecurity(db, ticker);

      // 2. Dividend history.
      //   - Default (full seed): 20-year backfill.
      //   - --refresh-prices / --quotes-only: 90-day window so new ex-dividend
      //     declarations land in the DB without paying the 20y price.
      //     Existing rows are de-duped by (ticker, ex_date, source) UNIQUE,
      //     so re-fetching the recent window is idempotent.
      if (!args.refreshPricesOnly && !args.quotesOnly) {
        log.info(`[${ticker}] fetching 20y dividend history`);
        const result = await fetchAndUpsertDividends(db, ticker);
        log.info(`[${ticker}] dividends: ${result.inserted} inserted / ${result.total} fetched`);
      } else {
        log.info(`[${ticker}] fetching recent dividend window (last 90 days)`);
        const recentStart = (() => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - 90);
          return d.toISOString().slice(0, 10);
        })();
        const result = await fetchAndUpsertDividends(db, ticker, { startDate: recentStart });
        if (result.inserted > 0) {
          log.info(
            `[${ticker}] new dividends: ${result.inserted} inserted (out of ${result.total})`,
          );
        }
      }

      // 3. Latest quote price
      log.info(`[${ticker}] fetching latest quote`);
      const quote = await fetchLatestQuote(ticker);
      if (quote) {
        upsertLatestPrice(db, quote);
        log.info(
          `[${ticker}] quote: $${(quote.priceCents / 100).toFixed(2)} as of ${quote.asOfDate}`,
        );
      } else {
        log.warn(`[${ticker}] no quote available`);
      }

      // 4. Legacy fundamentals (sustainability scorecard — keep for compat).
      log.info(`[${ticker}] fetching fundamentals`);
      const fund = await fetchFundamentals(ticker);
      if (fund) {
        upsertFundamentals(db, fund);
      }

      // 5. Rich quote snapshot (P/E, P/S, market cap, beta, etc.) — new in v0.4.
      log.info(`[${ticker}] fetching quote snapshot`);
      const snap = await fetchQuoteSnapshot(ticker);
      if (snap) {
        upsertQuoteSnapshot(db, snap);
      }

      // 6. ETF holdings (only for ETFs / mutual funds) — new in v0.4.
      if (isEtf) {
        log.info(`[${ticker}] fetching ETF holdings`);
        const holdings = await fetchEtfHoldings(ticker);
        if (holdings) {
          upsertEtfHoldings(db, ticker, holdings);
          log.info(
            `[${ticker}] holdings: top ${holdings.holdings.length} fetched, ${holdings.breakdown.sectorWeights.length} sector weights`,
          );
        }
      }

      // 7. Latest news — new in v0.4.
      if (!args.skipNews) {
        log.info(`[${ticker}] fetching news`);
        const news = await fetchTickerNews(ticker, 10);
        if (news.length > 0) {
          upsertNews(db, ticker, news);
        }
      }

      ok++;
    } catch (err) {
      failed++;
      log.error(`[${ticker}] FAILED`, { error: String(err) });
    }

    // Light pacing to avoid yfinance rate-limiting.
    await new Promise((r) => setTimeout(r, 250));
  }

  log.info(`Done fetching. ${ok} ok, ${failed} failed.`);

  // Cross-validate Yahoo's stored prices against Stooq, a fully independent
  // free EOD price source. Catches the "Yahoo silently broke" failure mode
  // that would otherwise need a human to spot.
  if (!args.skipValidation && targets.length > 0) {
    log.info('Cross-validating prices against Stooq...');
    const validation = await validateUniverseAgainstStooq(
      db,
      targets.map((t) => t.ticker),
    );
    const disagreements = validation.filter((v) => !v.agrees);
    const noYahoo = validation.filter((v) => v.reason === 'no-yahoo').length;
    const missingStooq = validation.filter((v) => v.reason === 'missing-source').length;
    const priceDrift = validation.filter((v) => v.reason === 'price-diverged');
    const dateDrift = validation.filter((v) => v.reason === 'date-mismatch');

    log.info(
      `Validation: ${validation.length - disagreements.length}/${validation.length} agree with Stooq (${priceDrift.length} price-drift, ${dateDrift.length} date-mismatch, ${missingStooq} no-stooq, ${noYahoo} no-yahoo)`,
    );
    for (const v of priceDrift) {
      const pct = v.deltaPct !== null ? (v.deltaPct * 100).toFixed(2) : 'n/a';
      log.warn(
        `[${v.ticker}] price drift: yahoo $${v.yahooClose} vs stooq $${v.stooqClose} (${pct}%)`,
      );
    }
    for (const v of dateDrift) {
      log.warn(`[${v.ticker}] date mismatch: yahoo bar ${v.date} vs stooq has different date`);
    }
  }

  log.info(`Done. ${ok} ok, ${failed} failed.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
