/**
 * Money / dividend amount conversion helpers.
 *
 * Two units in this codebase:
 *   - cents:  integer hundredths of a dollar.   $1.23  → 123
 *   - micros: integer millionths of a dollar.   $0.4225 → 422_500
 *
 * Cents are used for transaction amounts and prices (broker statements give us
 * 2-decimal precision). Micros are used for per-share dividends, which often
 * have 4-decimal precision on yfinance / SEC EDGAR.
 */

const CENTS_PER_DOLLAR = 100n;
const MICROS_PER_DOLLAR = 1_000_000n;

export function dollarsToCents(usd: number): number {
  if (!Number.isFinite(usd)) throw new Error(`dollarsToCents: not finite: ${usd}`);
  return Math.round(usd * 100);
}

export function centsToDollars(cents: number): number {
  return cents / 100;
}

export function dollarsToMicros(usd: number): number {
  if (!Number.isFinite(usd)) throw new Error(`dollarsToMicros: not finite: ${usd}`);
  return Math.round(usd * 1_000_000);
}

export function microsToDollars(micros: number): number {
  return micros / 1_000_000;
}

export function microsToCents(micros: number): number {
  return Math.round(micros / 10_000);
}

export function formatUsd(cents: number, opts: { sign?: boolean } = {}): string {
  const usd = centsToDollars(cents);
  const sign = opts.sign && usd > 0 ? '+' : '';
  return `${sign}$${usd.toFixed(2)}`;
}

// Re-export bigint constants in case callers need exact arithmetic
export const Money = {
  CENTS_PER_DOLLAR,
  MICROS_PER_DOLLAR,
};
