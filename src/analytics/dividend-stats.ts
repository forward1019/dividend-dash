/**
 * Dividend statistics engine. Pure functions over a list of dividend events
 * (ticker-level, per-share). No DB access here so it's trivially testable.
 */

import { microsToDollars } from '../lib/money.ts';
import type { Frequency } from '../types.ts';

export interface DividendEventInput {
  exDate: string; // YYYY-MM-DD
  amountPerShareMicros: number;
}

/**
 * Detect a security's payment frequency from the median gap between
 * consecutive ex-dividend dates over the last 2 years.
 */
export function detectFrequency(events: DividendEventInput[]): Frequency {
  if (events.length < 2) return 'unknown';

  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  const last2y = filterLastNYears(sorted, 2);
  if (last2y.length < 2) return 'unknown';

  const gaps: number[] = [];
  for (let i = 1; i < last2y.length; i++) {
    const a = new Date(last2y[i - 1]!.exDate).getTime();
    const b = new Date(last2y[i]!.exDate).getTime();
    gaps.push((b - a) / (86400 * 1000));
  }
  const median = medianOf(gaps);

  if (median < 18) return 'monthly'; // tighter range to handle 28-31 day months
  if (median < 50) return 'monthly';
  if (median < 110) return 'quarterly';
  if (median < 220) return 'semiannual';
  if (median < 500) return 'annual';
  return 'special';
}

/**
 * Sum of per-share dividends paid in the trailing 12 months ending `asOfDate`.
 * Returned in dollars (per share) for convenience.
 */
export function ttmDividendPerShare(events: DividendEventInput[], asOfDate?: string): number {
  const end = asOfDate ?? new Date().toISOString().slice(0, 10);
  const start = (() => {
    const d = new Date(end);
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const totalMicros = events
    .filter((e) => e.exDate > start && e.exDate <= end)
    .reduce((acc, e) => acc + e.amountPerShareMicros, 0);

  return microsToDollars(totalMicros);
}

/**
 * Calendar-year dividend per share, in dollars. Annualizes special dividends
 * (treats them as part of the year they fall in).
 */
export function annualDividendPerShare(events: DividendEventInput[], year: number): number {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  const totalMicros = events
    .filter((e) => e.exDate >= start && e.exDate <= end)
    .reduce((acc, e) => acc + e.amountPerShareMicros, 0);
  return microsToDollars(totalMicros);
}

/**
 * Compounded annual growth rate of per-share dividends over `years` calendar
 * years ending in the year of the most recent event. Returns null if there
 * isn't enough data or the start year had zero dividend.
 */
export function dividendCagr(events: DividendEventInput[], years: number): number | null {
  if (events.length === 0 || years < 1) return null;

  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  const lastYear = Number.parseInt(sorted[0]!.exDate.slice(0, 4), 10);
  const startYear = lastYear - years;

  const startAnnual = annualDividendPerShare(events, startYear);
  const endAnnual = annualDividendPerShare(events, lastYear);

  if (startAnnual <= 0 || endAnnual <= 0) return null;
  return (endAnnual / startAnnual) ** (1 / years) - 1;
}

/**
 * Consecutive years of non-decreasing annualized dividend, ending with the
 * most recent complete year. A "growth streak" = number of consecutive years
 * with annualized DPS strictly greater than the prior year.
 *
 * The year containing `asOfDate` is excluded if it isn't complete (we use the
 * prior calendar year as the most recent reference).
 */
export function growthStreakYears(events: DividendEventInput[], asOfDate?: string): number {
  if (events.length === 0) return 0;
  const ref = asOfDate ?? new Date().toISOString().slice(0, 10);
  const refYear = Number.parseInt(ref.slice(0, 4), 10);
  // We need a complete prior year to compare; start from refYear - 1.
  const lastCompleteYear = refYear - 1;

  const minYear = Math.min(...events.map((e) => Number.parseInt(e.exDate.slice(0, 4), 10)));

  let streak = 0;
  for (let y = lastCompleteYear; y > minYear; y--) {
    const cur = annualDividendPerShare(events, y);
    const prev = annualDividendPerShare(events, y - 1);
    if (cur > prev && prev > 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Forward yield estimate: annualize the most recent dividend payment based on
 * the detected frequency, and divide by `priceCents`.
 */
export function forwardYield(events: DividendEventInput[], priceCents: number): number | null {
  if (priceCents <= 0 || events.length === 0) return null;
  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  const latest = sorted[0]!;
  const freq = detectFrequency(events);
  const multiplier: Partial<Record<Frequency, number>> = {
    monthly: 12,
    quarterly: 4,
    semiannual: 2,
    annual: 1,
  };
  const m = multiplier[freq];
  if (!m) return null;

  const annualizedDollars = microsToDollars(latest.amountPerShareMicros) * m;
  const priceDollars = priceCents / 100;
  return annualizedDollars / priceDollars;
}

/** Trailing yield: TTM DPS / current price. */
export function trailingYield(events: DividendEventInput[], priceCents: number): number | null {
  if (priceCents <= 0) return null;
  const ttm = ttmDividendPerShare(events);
  if (ttm <= 0) return null;
  const priceDollars = priceCents / 100;
  return ttm / priceDollars;
}

// === helpers ===

function filterLastNYears(sorted: DividendEventInput[], n: number): DividendEventInput[] {
  if (sorted.length === 0) return sorted;
  const lastDate = new Date(sorted[sorted.length - 1]!.exDate);
  const cutoff = new Date(lastDate);
  cutoff.setFullYear(cutoff.getFullYear() - n);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return sorted.filter((e) => e.exDate >= cutoffStr);
}

function medianOf(arr: number[]): number {
  if (arr.length === 0) return Number.NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}
