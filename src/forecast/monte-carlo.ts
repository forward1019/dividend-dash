/**
 * Monte Carlo forward dividend income simulation.
 *
 * Model:
 *   1. For each holding, fit a log-normal distribution to the trailing
 *      annual dividend growth rates (last N years).
 *   2. For each of P paths (default 10,000), simulate H years of growth
 *      sampled from the per-holding distribution.
 *   3. At each year H, sum dividend income across all holdings on each path.
 *   4. Report P10/P50/P90 totals at each horizon.
 *
 * The log-normal assumption is documented in docs/decisions.md. It captures
 * the bounded-below-by-zero, right-skewed nature of dividend growth.
 *
 * Pure functions — no DB access. The CLI layer (Phase 5+) glues this to the
 * portfolio data.
 */

import { type Rng, mulberry32 } from './random.ts';

export interface HoldingForecastInput {
  ticker: string;
  /** Current annual dividend income from this holding, in dollars. */
  currentAnnualIncome: number;
  /** Historical year-over-year per-share dividend growth rates (decimals).
   *  At least 3 years recommended; 5-10 years ideal. */
  historicalGrowthRates: number[];
}

export interface MonteCarloOptions {
  /** Number of paths. Default 10,000. */
  paths?: number;
  /** Horizon in years. Default 20. */
  horizonYears: number;
  /** Floor on the fitted growth standard deviation; prevents degenerate
   *  zero-variance distributions when historical data is too short. */
  minStdDev?: number;
  /** Cap on per-year growth rate (in either direction) to suppress extreme
   *  paths; default ±50%. */
  growthClamp?: number;
  seed?: number;
}

export interface YearPercentiles {
  year: number; // 1, 2, ... horizonYears
  p10: number;
  p50: number;
  p90: number;
  mean: number;
}

export interface MonteCarloResult {
  perYear: YearPercentiles[];
  perHolding: { ticker: string; mu: number; sigma: number }[];
}

/**
 * Fit log-normal parameters (mu, sigma) to log(1 + growthRate) values.
 * If sigma is below `minStdDev`, raise it to that floor.
 */
export function fitLogNormal(
  growthRates: number[],
  minStdDev = 0.02,
): { mu: number; sigma: number } {
  if (growthRates.length === 0) {
    return { mu: 0, sigma: minStdDev };
  }
  // Use log(1 + g). Clamp to avoid log(0) if a 100% cut shows up.
  const logs = growthRates.map((g) => Math.log(Math.max(1 + g, 0.01)));
  const mu = logs.reduce((acc, x) => acc + x, 0) / logs.length;
  if (logs.length === 1) return { mu, sigma: minStdDev };
  const variance = logs.reduce((acc, x) => acc + (x - mu) ** 2, 0) / (logs.length - 1);
  const sigma = Math.max(Math.sqrt(variance), minStdDev);
  return { mu, sigma };
}

export function runMonteCarlo(
  holdings: HoldingForecastInput[],
  opts: MonteCarloOptions,
): MonteCarloResult {
  const paths = opts.paths ?? 10_000;
  const horizon = opts.horizonYears;
  const minStd = opts.minStdDev ?? 0.02;
  const clamp = opts.growthClamp ?? 0.5;
  const rng: Rng = mulberry32(opts.seed ?? 42);

  // Fit per-holding distributions
  const fits = holdings.map((h) => ({
    ticker: h.ticker,
    income: h.currentAnnualIncome,
    ...fitLogNormal(h.historicalGrowthRates, minStd),
  }));

  // For each year, allocate a Float64Array of path totals
  const yearTotals: Float64Array[] = [];
  for (let y = 0; y < horizon; y++) {
    yearTotals.push(new Float64Array(paths));
  }

  for (let p = 0; p < paths; p++) {
    // For each holding, walk a growth path independently
    for (const h of fits) {
      let income = h.income;
      for (let y = 0; y < horizon; y++) {
        const log1g = rng.normal(h.mu, h.sigma);
        let g = Math.exp(log1g) - 1;
        if (g > clamp) g = clamp;
        if (g < -clamp) g = -clamp;
        income = income * (1 + g);
        if (income < 0) income = 0;
        yearTotals[y]![p]! += income;
      }
    }
  }

  const perYear: YearPercentiles[] = yearTotals.map((arr, y) => {
    const sorted = Float64Array.from(arr).sort();
    const p10 = sorted[Math.floor(paths * 0.1)]!;
    const p50 = sorted[Math.floor(paths * 0.5)]!;
    const p90 = sorted[Math.floor(paths * 0.9)]!;
    let sum = 0;
    for (let i = 0; i < paths; i++) sum += sorted[i]!;
    const mean = sum / paths;
    return { year: y + 1, p10, p50, p90, mean };
  });

  return {
    perYear,
    perHolding: fits.map((f) => ({ ticker: f.ticker, mu: f.mu, sigma: f.sigma })),
  };
}

/**
 * Convert a flat-CAGR-from-history series of annual DPS into year-over-year
 * growth rates. e.g. [1.0, 1.05, 1.10, 1.16] → [0.05, 0.0476, 0.0545]
 */
export function dpsHistoryToGrowthRates(annualDps: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < annualDps.length; i++) {
    const prev = annualDps[i - 1]!;
    const cur = annualDps[i]!;
    if (prev > 0) out.push(cur / prev - 1);
  }
  return out;
}
