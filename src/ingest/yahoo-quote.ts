/**
 * Quote + fundamentals fetcher built on top of yahoo-finance2 v3.
 *
 * Persists:
 *   - latest EOD price into `prices`
 *   - quoteSummary fundamentals (payout ratio, FCF, debt) into `fundamentals`
 *
 * yfinance's quoteSummary modules vary in availability per ticker
 * (especially for ETFs). All callers must tolerate missing fields.
 *
 * v3 API quirk: `quote().trailingAnnualDividendYield` and `dividendYield`
 * are now returned as PERCENTAGES (e.g. 3.44 means 3.44%) — divide by 100
 * to convert to a fraction.
 */

import YahooFinance from 'yahoo-finance2';
import { z } from 'zod';

import type { Database } from 'bun:sqlite';

import { upsertSecurity } from '../db/repo.ts';
import { log } from '../lib/logger.ts';
import { dollarsToMicros } from '../lib/money.ts';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// === Quote (latest price + meta) ===

export interface LatestQuote {
  ticker: string;
  priceCents: number;
  asOfDate: string;
  trailingYield: number | null; // 0..1 (converted from yfinance percentage)
  marketCap: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  shortName: string | null;
  longName: string | null;
  currency: string;
}

const QuoteSchema = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number().optional(),
  regularMarketTime: z.union([z.date(), z.string(), z.number()]).optional(),
  trailingAnnualDividendYield: z.number().optional(),
  dividendYield: z.number().optional(),
  marketCap: z.number().optional(),
  fiftyTwoWeekHigh: z.number().optional(),
  fiftyTwoWeekLow: z.number().optional(),
  shortName: z.string().optional(),
  longName: z.string().optional(),
  currency: z.string().optional(),
});

export async function fetchLatestQuote(ticker: string): Promise<LatestQuote | null> {
  const t = ticker.toUpperCase();
  try {
    const q = await yf.quote(t);
    const parsed = QuoteSchema.safeParse(q);
    if (!parsed.success) {
      log.warn(`yfinance quote for ${t} failed schema validation`, {
        error: parsed.error.message,
      });
      return null;
    }
    const price = parsed.data.regularMarketPrice;
    if (price === undefined) return null;

    const asOf = (() => {
      const tRaw = parsed.data.regularMarketTime;
      if (tRaw instanceof Date) return tRaw.toISOString().slice(0, 10);
      if (typeof tRaw === 'number') return new Date(tRaw * 1000).toISOString().slice(0, 10);
      if (typeof tRaw === 'string') return new Date(tRaw).toISOString().slice(0, 10);
      return new Date().toISOString().slice(0, 10);
    })();

    // yfinance v3 returns yield as a percentage (3.44 = 3.44%) — convert to fraction.
    const yieldPct = parsed.data.trailingAnnualDividendYield ?? parsed.data.dividendYield ?? null;
    const yieldFrac = yieldPct !== null ? yieldPct / 100 : null;

    return {
      ticker: t,
      priceCents: Math.round(price * 100),
      asOfDate: asOf,
      trailingYield: yieldFrac,
      marketCap: parsed.data.marketCap ?? null,
      fiftyTwoWeekHigh: parsed.data.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: parsed.data.fiftyTwoWeekLow ?? null,
      shortName: parsed.data.shortName ?? null,
      longName: parsed.data.longName ?? null,
      currency: parsed.data.currency ?? 'USD',
    };
  } catch (err) {
    log.warn(`yfinance quote threw for ${t}`, { error: String(err) });
    return null;
  }
}

export function upsertLatestPrice(db: Database, q: LatestQuote): void {
  upsertSecurity(db, { ticker: q.ticker, name: q.longName ?? q.shortName ?? q.ticker });
  db.run(
    `INSERT INTO prices(ticker, date, close_cents, source)
     VALUES (?, ?, ?, 'yfinance')
     ON CONFLICT(ticker, date, source) DO UPDATE SET close_cents = excluded.close_cents`,
    [q.ticker, q.asOfDate, q.priceCents],
  );
}

// === Fundamentals ===

export interface FundamentalsSnapshot {
  ticker: string;
  asOfDate: string;
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  epsMicros: number | null;
  fcfPerShareMicros: number | null;
}

const QuoteSummarySchema = z.object({
  summaryDetail: z
    .object({
      payoutRatio: z.number().optional(),
      trailingAnnualDividendRate: z.number().optional(),
    })
    .optional(),
  defaultKeyStatistics: z
    .object({
      trailingEps: z.number().optional(),
      sharesOutstanding: z.number().optional(),
    })
    .optional(),
  financialData: z
    .object({
      freeCashflow: z.number().optional(),
      debtToEquity: z.number().optional(), // returned as percentage (e.g. 145.2)
    })
    .optional(),
});

export async function fetchFundamentals(ticker: string): Promise<FundamentalsSnapshot | null> {
  const t = ticker.toUpperCase();
  try {
    const summary = await yf.quoteSummary(t, {
      modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'],
    });
    const parsed = QuoteSummarySchema.safeParse(summary);
    if (!parsed.success) {
      log.warn(`quoteSummary schema failed for ${t}`, { error: parsed.error.message });
      return null;
    }

    const eps = parsed.data.defaultKeyStatistics?.trailingEps ?? null;
    const shares = parsed.data.defaultKeyStatistics?.sharesOutstanding ?? null;
    const fcf = parsed.data.financialData?.freeCashflow ?? null;
    const fcfPerShare = fcf && shares && shares > 0 ? fcf / shares : null;
    const dpsAnnual = parsed.data.summaryDetail?.trailingAnnualDividendRate ?? null;
    const fcfPayoutRatio =
      dpsAnnual !== null && fcfPerShare !== null && fcfPerShare > 0
        ? dpsAnnual / fcfPerShare
        : null;

    // yfinance returns debt/equity as a percentage (e.g. 145.2 means 1.452 ratio)
    const dEqRaw = parsed.data.financialData?.debtToEquity ?? null;
    const debtToEquity = dEqRaw !== null ? dEqRaw / 100 : null;

    return {
      ticker: t,
      asOfDate: new Date().toISOString().slice(0, 10),
      payoutRatio: parsed.data.summaryDetail?.payoutRatio ?? null,
      fcfPayoutRatio,
      debtToEquity,
      epsMicros: eps !== null ? dollarsToMicros(eps) : null,
      fcfPerShareMicros: fcfPerShare !== null ? dollarsToMicros(fcfPerShare) : null,
    };
  } catch (err) {
    log.warn(`quoteSummary threw for ${t}`, { error: String(err) });
    return null;
  }
}

export function upsertFundamentals(db: Database, f: FundamentalsSnapshot): void {
  upsertSecurity(db, { ticker: f.ticker, name: f.ticker });
  db.run(
    `INSERT INTO fundamentals(
       ticker, as_of_date, eps_micros, fcf_per_share_micros,
       payout_ratio, fcf_payout_ratio, debt_to_equity, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'yfinance')
     ON CONFLICT(ticker, as_of_date, source) DO UPDATE SET
       eps_micros = excluded.eps_micros,
       fcf_per_share_micros = excluded.fcf_per_share_micros,
       payout_ratio = excluded.payout_ratio,
       fcf_payout_ratio = excluded.fcf_payout_ratio,
       debt_to_equity = excluded.debt_to_equity`,
    [
      f.ticker,
      f.asOfDate,
      f.epsMicros,
      f.fcfPerShareMicros,
      f.payoutRatio,
      f.fcfPayoutRatio,
      f.debtToEquity,
    ],
  );
}
