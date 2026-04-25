/**
 * yahoo-finance2 wrapper. Fetches dividend history and basic security
 * metadata, validates with Zod, writes to SQLite.
 */

import yahooFinance from 'yahoo-finance2';
import { z } from 'zod';

import type { Database } from 'bun:sqlite';

import { insertDividendEvent, upsertSecurity } from '../db/repo.ts';
import { log } from '../lib/logger.ts';
import { dollarsToMicros } from '../lib/money.ts';
import type { DividendEvent } from '../types.ts';

// Suppress yfinance survey noise globally.
yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

const QuoteResponseSchema = z.object({
  symbol: z.string(),
  shortName: z.string().optional(),
  longName: z.string().optional(),
  fullExchangeName: z.string().optional(),
  exchange: z.string().optional(),
  currency: z.string().optional(),
  sector: z.string().optional(),
  industry: z.string().optional(),
});

export async function fetchAndUpsertSecurity(db: Database, ticker: string): Promise<void> {
  const t = ticker.toUpperCase();
  try {
    const q = await yahooFinance.quote(t);
    const parsed = QuoteResponseSchema.safeParse(q);
    if (!parsed.success) {
      log.warn(`yfinance quote for ${t} failed schema validation`, { error: parsed.error.message });
      upsertSecurity(db, { ticker: t, name: t });
      return;
    }
    upsertSecurity(db, {
      ticker: t,
      name: parsed.data.longName ?? parsed.data.shortName ?? t,
      sector: parsed.data.sector ?? null,
      industry: parsed.data.industry ?? null,
      exchange: parsed.data.fullExchangeName ?? parsed.data.exchange ?? null,
      currency: parsed.data.currency ?? 'USD',
    });
  } catch (err) {
    log.warn(`yfinance quote for ${t} threw`, { error: String(err) });
    upsertSecurity(db, { ticker: t, name: t });
  }
}

const DividendRowSchema = z.object({
  date: z.coerce.date(),
  amount: z.number().nonnegative(),
});

export interface FetchDividendsOptions {
  /** ISO YYYY-MM-DD. Defaults to 20 years ago. */
  startDate?: string;
  /** ISO YYYY-MM-DD. Defaults to today. */
  endDate?: string;
}

export async function fetchAndUpsertDividends(
  db: Database,
  ticker: string,
  opts: FetchDividendsOptions = {},
): Promise<{ inserted: number; total: number }> {
  const t = ticker.toUpperCase();
  const period1 =
    opts.startDate ?? new Date(Date.now() - 20 * 365 * 86400 * 1000).toISOString().slice(0, 10);
  const period2 = opts.endDate ?? new Date().toISOString().slice(0, 10);

  // yahoo-finance2's `chart()` returns dividend events in events.dividends
  const result = await yahooFinance.chart(t, {
    period1,
    period2,
    interval: '1d',
    events: 'div',
  });

  const events = (result.events?.dividends ?? []) as Array<{ date: Date | string; amount: number }>;

  let inserted = 0;
  for (const ev of events) {
    const parsed = DividendRowSchema.safeParse(ev);
    if (!parsed.success) {
      log.debug(`skipping malformed dividend event for ${t}`, { error: parsed.error.message });
      continue;
    }
    const event: DividendEvent = {
      ticker: t,
      exDate: parsed.data.date.toISOString().slice(0, 10),
      amountPerShareMicros: dollarsToMicros(parsed.data.amount),
      source: 'yfinance',
    };
    if (insertDividendEvent(db, event)) inserted++;
  }

  return { inserted, total: events.length };
}
