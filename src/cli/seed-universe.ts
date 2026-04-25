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
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { tickers: [], refreshPricesOnly: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--ticker=')) {
      args.tickers = a
        .slice('--ticker='.length)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else if (a === '--refresh-prices') {
      args.refreshPricesOnly = true;
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
    try {
      // 1. Security metadata (always)
      log.info(`[${ticker}] fetching metadata`);
      await fetchAndUpsertSecurity(db, ticker);

      // 2. Dividend history (skip on refresh-prices mode)
      if (!args.refreshPricesOnly) {
        log.info(`[${ticker}] fetching 20y dividend history`);
        const result = await fetchAndUpsertDividends(db, ticker);
        log.info(`[${ticker}] dividends: ${result.inserted} inserted / ${result.total} fetched`);
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

      // 4. Fundamentals (best effort — ETFs often return nothing)
      log.info(`[${ticker}] fetching fundamentals`);
      const fund = await fetchFundamentals(ticker);
      if (fund) {
        upsertFundamentals(db, fund);
      }

      ok++;
    } catch (err) {
      failed++;
      log.error(`[${ticker}] FAILED`, { error: String(err) });
    }

    // Light pacing to avoid yfinance rate-limiting.
    await new Promise((r) => setTimeout(r, 250));
  }

  log.info(`Done. ${ok} ok, ${failed} failed.`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
