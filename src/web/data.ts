/**
 * Data accessor layer for the web dashboard. Pure read-only helpers that
 * compute every metric the UI needs from SQLite + analytics modules.
 *
 * Everything cached to a 60-second in-memory map so a dashboard refresh
 * doesn't re-query 40 tickers' worth of analytics.
 */

import { Database } from 'bun:sqlite';

import {
  type DividendEventInput,
  detectFrequency,
  dividendCagr,
  forwardYield,
  growthStreakYears,
  trailingYield,
  ttmDividendPerShare,
} from '../analytics/dividend-stats.ts';
import { type SustainabilityScore, scoreSustainability } from '../analytics/sustainability.ts';
import { config } from '../lib/config.ts';
import { microsToDollars } from '../lib/money.ts';
import {
  CATEGORY_LABELS,
  DIVIDEND_UNIVERSE,
  type UniverseCategory,
  type UniverseTicker,
} from './tickers.ts';

const _db = new Database(config.dbPath, { create: true });

export function getDb(): Database {
  return _db;
}

// === Cache ===
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; until: number }>();
function memo<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const value = fn();
  cache.set(key, { value, until: now + CACHE_TTL_MS });
  return value;
}
export function clearCache(): void {
  cache.clear();
}

// === Types ===

export interface TickerCard {
  ticker: string;
  name: string;
  category: UniverseCategory;
  categoryLabel: string;
  kind: 'etf' | 'stock';
  notes?: string;
  // pricing
  priceCents: number | null;
  priceAsOf: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  // dividends
  ttmDps: number | null; // dollars
  forwardYield: number | null; // 0..1
  trailingYield: number | null; // 0..1
  cagr5y: number | null; // 0..1
  cagr10y: number | null;
  growthStreak: number;
  frequency: string;
  lastDividend: { exDate: string; amount: number } | null; // amount = dollars
  // sustainability
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  sustainability: SustainabilityScore;
  // misc
  hasFundamentals: boolean;
}

export interface DividendHistoryPoint {
  exDate: string;
  amount: number; // dollars per share
}

export interface PricePoint {
  date: string;
  closeCents: number;
}

export interface YocPoint {
  date: string;
  yoc: number; // 0..1
}

export interface CalendarEntry {
  ticker: string;
  name: string;
  exDate: string;
  payDate: string | null;
  amount: number; // dollars
  daysUntil: number;
}

// === Queries ===

export function getDividendEvents(ticker: string): DividendEventInput[] {
  const db = getDb();
  return db
    .query<{ ex_date: string; amount_per_share_micros: number }, [string]>(
      `SELECT ex_date, amount_per_share_micros FROM dividend_events
       WHERE ticker = ? AND source = 'yfinance' ORDER BY ex_date ASC`,
    )
    .all(ticker.toUpperCase())
    .map((r) => ({ exDate: r.ex_date, amountPerShareMicros: r.amount_per_share_micros }));
}

export function getDividendHistory(ticker: string): DividendHistoryPoint[] {
  return getDividendEvents(ticker).map((e) => ({
    exDate: e.exDate,
    amount: microsToDollars(e.amountPerShareMicros),
  }));
}

export function getLatestPrice(ticker: string): { priceCents: number; date: string } | null {
  const db = getDb();
  const row = db
    .query<{ close_cents: number; date: string }, [string]>(
      'SELECT close_cents, date FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1',
    )
    .get(ticker.toUpperCase());
  if (!row) return null;
  return { priceCents: row.close_cents, date: row.date };
}

export function getLatestFundamentals(ticker: string): {
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  asOfDate: string;
} | null {
  const db = getDb();
  const row = db
    .query<
      {
        payout_ratio: number | null;
        fcf_payout_ratio: number | null;
        debt_to_equity: number | null;
        as_of_date: string;
      },
      [string]
    >(
      `SELECT payout_ratio, fcf_payout_ratio, debt_to_equity, as_of_date
       FROM fundamentals WHERE ticker = ? ORDER BY as_of_date DESC LIMIT 1`,
    )
    .get(ticker.toUpperCase());
  if (!row) return null;
  return {
    payoutRatio: row.payout_ratio,
    fcfPayoutRatio: row.fcf_payout_ratio,
    debtToEquity: row.debt_to_equity,
    asOfDate: row.as_of_date,
  };
}

export function getSecurityMeta(ticker: string): {
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
} | null {
  const db = getDb();
  const row = db
    .query<
      {
        name: string;
        sector: string | null;
        industry: string | null;
        exchange: string | null;
      },
      [string]
    >('SELECT name, sector, industry, exchange FROM securities WHERE ticker = ?')
    .get(ticker.toUpperCase());
  return row ?? null;
}

export function getQuoteFromYf(ticker: string): {
  high: number | null;
  low: number | null;
} | null {
  // We don't store 52w high/low in the schema. The dashboard derives them
  // from the price series for now.
  const db = getDb();
  const rows = db
    .query<{ high: number | null; low: number | null }, [string]>(
      `SELECT MAX(close_cents) AS high, MIN(close_cents) AS low
       FROM prices WHERE ticker = ?
         AND date >= date('now', '-365 days')`,
    )
    .get(ticker.toUpperCase());
  if (!rows) return null;
  return rows;
}

// === Card builder ===

export function buildTickerCard(u: UniverseTicker): TickerCard {
  return memo(`card:${u.ticker}`, () => {
    const events = getDividendEvents(u.ticker);
    const price = getLatestPrice(u.ticker);
    const fund = getLatestFundamentals(u.ticker);
    const meta = getSecurityMeta(u.ticker);

    const priceCents = price?.priceCents ?? null;
    const fwd = priceCents !== null ? forwardYield(events, priceCents) : null;
    const trail = priceCents !== null ? trailingYield(events, priceCents) : null;
    const ttm = events.length > 0 ? ttmDividendPerShare(events) : null;
    const c5 = dividendCagr(events, 5);
    const c10 = dividendCagr(events, 10);
    const streak = growthStreakYears(events);
    const freq = detectFrequency(events);

    const last = events.length > 0 ? events[events.length - 1]! : null;
    const lastDividend = last
      ? { exDate: last.exDate, amount: microsToDollars(last.amountPerShareMicros) }
      : null;

    const sust = scoreSustainability({
      payoutRatio: fund?.payoutRatio ?? null,
      fcfPayoutRatio: fund?.fcfPayoutRatio ?? null,
      growthStreakYears: streak,
      debtToEquity: fund?.debtToEquity ?? null,
    });

    const high52 = (() => {
      const r = getQuoteFromYf(u.ticker);
      return r?.high ?? null;
    })();
    const low52 = (() => {
      const r = getQuoteFromYf(u.ticker);
      return r?.low ?? null;
    })();

    return {
      ticker: u.ticker,
      name: meta?.name ?? u.name,
      category: u.category,
      categoryLabel: CATEGORY_LABELS[u.category],
      kind: u.kind,
      notes: u.notes,
      priceCents,
      priceAsOf: price?.date ?? null,
      fiftyTwoWeekHigh: high52,
      fiftyTwoWeekLow: low52,
      ttmDps: ttm,
      forwardYield: fwd,
      trailingYield: trail,
      cagr5y: c5,
      cagr10y: c10,
      growthStreak: streak,
      frequency: freq,
      lastDividend,
      payoutRatio: fund?.payoutRatio ?? null,
      fcfPayoutRatio: fund?.fcfPayoutRatio ?? null,
      debtToEquity: fund?.debtToEquity ?? null,
      sustainability: sust,
      hasFundamentals: fund !== null,
    };
  });
}

export function buildAllCards(): TickerCard[] {
  return DIVIDEND_UNIVERSE.map(buildTickerCard);
}

// === Dividend calendar ===

/**
 * Estimate upcoming ex-dividend dates by extrapolating the last known
 * payment forward by the detected frequency. Real ex-dates are
 * announced 1–2 quarters out — yfinance includes them in the chart
 * results when known. We'll take what we can get.
 */
export function buildCalendar(daysAhead = 90): CalendarEntry[] {
  return memo(`calendar:${daysAhead}`, () => {
    const today = new Date();
    const out: CalendarEntry[] = [];
    for (const u of DIVIDEND_UNIVERSE) {
      const events = getDividendEvents(u.ticker);
      if (events.length === 0) continue;
      const last = events[events.length - 1]!;
      const freq = detectFrequency(events);
      const stride = (
        {
          monthly: 30,
          quarterly: 91,
          semiannual: 182,
          annual: 365,
          special: 365,
          unknown: 91,
        } as const
      )[freq];

      const lastEx = new Date(last.exDate);
      let next = new Date(lastEx);
      next.setDate(next.getDate() + stride);

      // If "next" is already in the past, walk forward until in the future
      while (next.getTime() < today.getTime()) {
        next = new Date(next.getTime() + stride * 86400 * 1000);
      }

      const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400_000);
      if (daysUntil > daysAhead) continue;

      const meta = getSecurityMeta(u.ticker);
      out.push({
        ticker: u.ticker,
        name: meta?.name ?? u.name,
        exDate: next.toISOString().slice(0, 10),
        payDate: null,
        amount: microsToDollars(last.amountPerShareMicros),
        daysUntil,
      });
    }
    out.sort((a, b) => a.daysUntil - b.daysUntil);
    return out;
  });
}

// === Yield-on-cost helper for charts ===

export function buildYocSeries(ticker: string, costBasisPerShare: number): YocPoint[] {
  const events = getDividendEvents(ticker);
  if (events.length === 0 || costBasisPerShare <= 0) return [];

  // Group dividends by year, compute trailing 12-month sum at each event,
  // then YOC = TTM / cost.
  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  const points: YocPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const asOf = sorted[i]!.exDate;
    const ttmDollars = ttmDividendPerShare(sorted.slice(0, i + 1), asOf);
    const yoc = ttmDollars / costBasisPerShare;
    if (yoc > 0) points.push({ date: asOf, yoc });
  }
  return points;
}
