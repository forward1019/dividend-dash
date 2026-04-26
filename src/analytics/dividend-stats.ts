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
 * Returned in dollars (per share) for convenience. Includes special and
 * supplemental dividends — i.e. this is the cash-realized number.
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

/** Per-event classification produced by {@link classifyDividends}. */
export type DividendClass = 'regular' | 'special';

export interface ClassifiedDividend extends DividendEventInput {
  classification: DividendClass;
}

/**
 * Classify each event as 'regular' or 'special'.
 *
 * Algorithm (anchor-cohort, applied per ±`windowRadius` window):
 *   1. Within the local window, find the amount that has the most
 *      neighbors within `bandPct` ("the anchor" — the dominant regular).
 *   2. If the anchor's cohort covers ≥`minAnchorShare` of the window,
 *      the stream has a clear regular cadence here. Events whose
 *      amount is more than `bandPct` away from the anchor AND at least
 *      `specialMargin` above it are tagged 'special'. Everything else
 *      (including events below the anchor — usually a temporary cut, not
 *      a "special") is tagged 'regular'.
 *   3. If no amount qualifies as an anchor (stream too noisy — ETFs
 *      with bumpy quarterly payouts), default everything to 'regular'.
 *
 * Why this works on real data:
 *   - Steady $0.25 quarterly: every event is the anchor → all-regular.
 *   - 5%/yr raises: tight cohort drifts smoothly → all-regular.
 *   - MAIN ($0.26 monthly + $0.30 quarterly supplementals): $0.26 is
 *     the anchor (covers >50% of any 9-event window), $0.30 events sit
 *     ≥15% above and get tagged 'special'.
 *   - 1-off 3× bonus on a stable stream: anchor is the steady amount,
 *     bonus is well above → 'special'.
 *   - Vanguard-style ETF with $0.84/$0.86/$0.94/$1.02 quarterly spread:
 *     no single amount dominates → all-regular (correct: these are just
 *     pass-through fluctuations, not specials).
 *
 * Streams shorter than 6 events are always classified 'regular'.
 *
 * Used by:
 *   - {@link forwardYield}                — what's sustainable forward
 *   - {@link ttmRegularDividendPerShare}  — what the issuer commits to
 */
export function classifyDividends(
  events: DividendEventInput[],
  opts: {
    bandPct?: number;
    windowRadius?: number;
    minAnchorShare?: number;
    specialMargin?: number;
  } = {},
): ClassifiedDividend[] {
  const bandPct = opts.bandPct ?? 0.05;
  const windowRadius = opts.windowRadius ?? 4;
  const minAnchorShare = opts.minAnchorShare ?? 0.5;
  const specialMargin = opts.specialMargin ?? 0.1;
  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  if (sorted.length < 6) {
    return sorted.map((e) => ({ ...e, classification: 'regular' as const }));
  }

  return sorted.map((ev, i) => {
    const lo = Math.max(0, i - windowRadius);
    const hi = Math.min(sorted.length - 1, i + windowRadius);
    const window = sorted.slice(lo, hi + 1);

    // Find the amount whose ±bandPct cohort covers the most events.
    let bestCohort = 0;
    let anchorMicros = 0;
    for (const candidate of window) {
      const c = candidate.amountPerShareMicros;
      if (c <= 0) continue;
      let cohort = 0;
      for (const w of window) {
        if (Math.abs(w.amountPerShareMicros - c) / c <= bandPct) cohort++;
      }
      if (cohort > bestCohort) {
        bestCohort = cohort;
        anchorMicros = c;
      }
    }

    // Stream is too noisy (no clear regular cohort)? Default to regular.
    if (anchorMicros === 0 || bestCohort / window.length < minAnchorShare) {
      return { ...ev, classification: 'regular' as DividendClass };
    }

    const ratio = ev.amountPerShareMicros / anchorMicros;
    // Within the band of the anchor, or below it — call it regular.
    // Below-anchor events are typically temporary cuts, not specials,
    // and tagging them special would mask cut-detection logic.
    if (ratio <= 1 + Math.max(bandPct, specialMargin)) {
      return { ...ev, classification: 'regular' as DividendClass };
    }
    return { ...ev, classification: 'special' as DividendClass };
  });
}

/**
 * TTM dividend per share counting only `regular` payments (specials and
 * supplementals excluded). This is the number to use for "what does the
 * issuer commit to paying me" and for forward yield projections.
 */
export function ttmRegularDividendPerShare(
  events: DividendEventInput[],
  asOfDate?: string,
): number {
  const classified = classifyDividends(events);
  const regulars = classified.filter((c) => c.classification === 'regular');
  return ttmDividendPerShare(regulars, asOfDate);
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
 * years ending in the most recent COMPLETE year. Returns null if there
 * isn't enough data or the start year had zero dividend.
 *
 * "Complete year" rule: if the most recent event is in the current calendar
 * year, we fall back to (currentYear - 1) as the endpoint so a partial-year
 * sum doesn't drag the CAGR down. Otherwise we use the most recent event's
 * year directly. This keeps unit tests (which don't pass a clock) stable
 * while protecting live data from the 2026-04-25 SCHD-style anomaly.
 */
export function dividendCagr(events: DividendEventInput[], years: number): number | null {
  if (events.length === 0 || years < 1) return null;

  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  const latestEventYear = Number.parseInt(sorted[0]!.exDate.slice(0, 4), 10);
  const currentYear = new Date().getUTCFullYear();
  const lastYear = latestEventYear === currentYear ? latestEventYear - 1 : latestEventYear;
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
 * Forward yield estimate: annualize the most recent REGULAR dividend payment
 * based on the detected frequency, and divide by `priceCents`. Specials and
 * supplementals are excluded so a one-off bonus (MAIN, CME, etc.) doesn't
 * inflate the projection.
 */
export function forwardYield(events: DividendEventInput[], priceCents: number): number | null {
  if (priceCents <= 0 || events.length === 0) return null;
  const classified = classifyDividends(events);
  const regulars = classified.filter((c) => c.classification === 'regular');
  if (regulars.length === 0) return null;

  const sorted = [...regulars].sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  const latest = sorted[0]!;
  // Frequency is detected from regulars only — supplementals would tighten
  // the median gap and falsely upgrade a quarterly payer to "monthly".
  const freq = detectFrequency(regulars);
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
