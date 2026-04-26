/**
 * Stooq.com price fetcher — a free, no-API-key second source we use to
 * cross-validate Yahoo's EOD prices and to fall back when yfinance is
 * down. Stooq exposes a daily-bar CSV at:
 *
 *   https://stooq.com/q/l/?s=<symbol>.US&f=sd2t2ohlcv&h&e=csv
 *
 * Returned columns: Symbol,Date,Time,Open,High,Low,Close,Volume.
 *
 * Stooq covers all major US tickers we track. International ETFs work
 * too (e.g. VYMI.US, REET.US) — Stooq normalizes US listings under the
 * `.US` suffix.
 *
 * No rate-limiting issues observed at our scale (60 tickers/day), but
 * we still throttle politely to 5 req/sec.
 */

import type { Database } from 'bun:sqlite';

import { log } from '../lib/logger.ts';

export interface StooqQuote {
  ticker: string;
  date: string; // ISO YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const STOOQ_URL = 'https://stooq.com/q/l/';

/**
 * Fetch the most recent daily bar for `ticker` from Stooq.
 * Returns null on network error, parse error, or "N/D" rows (Stooq's
 * "no data" sentinel for malformed symbols).
 */
export async function fetchStooqQuote(ticker: string): Promise<StooqQuote | null> {
  const symbol = `${ticker.toUpperCase()}.US`;
  const url = `${STOOQ_URL}?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcv&h&e=csv`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'dividend-dash/0.5 (+github.com/forward1019/dividend-dash)' },
    });
    if (!res.ok) {
      log.warn(`stooq HTTP ${res.status} for ${symbol}`);
      return null;
    }
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const header = lines[0]!.toLowerCase().split(',');
    const row = lines[1]!.split(',');
    if (row.length !== header.length) return null;
    if (row.some((v) => v === 'N/D')) {
      log.debug(`stooq returned N/D for ${symbol}`);
      return null;
    }

    const get = (k: string): string | undefined => {
      const i = header.indexOf(k);
      return i >= 0 ? row[i] : undefined;
    };
    const date = get('date');
    const close = Number.parseFloat(get('close') ?? '');
    if (!date || !Number.isFinite(close)) return null;
    return {
      ticker: ticker.toUpperCase(),
      date,
      open: Number.parseFloat(get('open') ?? '') || 0,
      high: Number.parseFloat(get('high') ?? '') || 0,
      low: Number.parseFloat(get('low') ?? '') || 0,
      close,
      volume: Number.parseInt(get('volume') ?? '0', 10) || 0,
    };
  } catch (err) {
    log.warn(`stooq fetch failed for ${symbol}`, { error: String(err) });
    return null;
  }
}

export interface PriceValidation {
  ticker: string;
  yahooClose: number | null;
  stooqClose: number | null;
  date: string | null;
  deltaPct: number | null;
  agrees: boolean; // |delta| < 1% AND dates match
  reason: 'agree' | 'price-diverged' | 'date-mismatch' | 'missing-source' | 'no-yahoo';
}

/**
 * Compare today's stored Yahoo EOD price against a fresh Stooq pull.
 * Used by `seed-universe` to surface stale or wrong data immediately
 * instead of waiting for the user to notice.
 *
 * Threshold: 1% (handles minor adjustments for splits/dividends that
 * land on different exchanges' close-of-day rollups). Date mismatch
 * fails too — if Stooq has Friday's bar but Yahoo has Thursday's, the
 * Yahoo refresh quietly failed and we should know.
 */
export async function validatePriceAgainstStooq(
  db: Database,
  ticker: string,
): Promise<PriceValidation> {
  const t = ticker.toUpperCase();
  const yahooRow = db
    .query<{ close_cents: number; date: string }, [string]>(
      "SELECT close_cents, date FROM prices WHERE ticker = ? AND source = 'yfinance' ORDER BY date DESC LIMIT 1",
    )
    .get(t);

  const stooq = await fetchStooqQuote(t);

  if (!yahooRow) {
    return {
      ticker: t,
      yahooClose: null,
      stooqClose: stooq?.close ?? null,
      date: stooq?.date ?? null,
      deltaPct: null,
      agrees: false,
      reason: 'no-yahoo',
    };
  }
  if (!stooq) {
    return {
      ticker: t,
      yahooClose: yahooRow.close_cents / 100,
      stooqClose: null,
      date: yahooRow.date,
      deltaPct: null,
      agrees: false,
      reason: 'missing-source',
    };
  }

  const yahooClose = yahooRow.close_cents / 100;
  const delta = (stooq.close - yahooClose) / yahooClose;
  const datesMatch = stooq.date === yahooRow.date;
  const priceAgrees = Math.abs(delta) < 0.01;
  const agrees = datesMatch && priceAgrees;

  return {
    ticker: t,
    yahooClose,
    stooqClose: stooq.close,
    date: yahooRow.date,
    deltaPct: delta,
    agrees,
    reason: agrees
      ? 'agree'
      : !datesMatch
        ? 'date-mismatch'
        : !priceAgrees
          ? 'price-diverged'
          : 'agree',
  };
}

/**
 * Validate a list of tickers in series. Returns full report regardless
 * of agreement; the caller decides whether to log/alert/abort.
 *
 * Bounded concurrency intentionally low (1) — Stooq is generous but
 * we have no business hammering a free public service for 60 tickers
 * in parallel.
 */
export async function validateUniverseAgainstStooq(
  db: Database,
  tickers: string[],
): Promise<PriceValidation[]> {
  const out: PriceValidation[] = [];
  for (const t of tickers) {
    const v = await validatePriceAgainstStooq(db, t);
    out.push(v);
    // Polite pacing — 200ms between calls.
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}
