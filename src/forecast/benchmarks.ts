/**
 * Personal benchmark: what would my $X allocation produce in SCHD/VYM/SPY?
 *
 * Uses historical TTM yields for the benchmark ETFs (refreshed via yfinance).
 * Reports:
 *   - benchmark current annual income on $X
 *   - benchmark forward Monte Carlo range
 *   - delta vs my actual portfolio
 */

import { type HoldingForecastInput, runMonteCarlo } from './monte-carlo.ts';

export interface BenchmarkInput {
  ticker: string; // SCHD, VYM, SPY, etc.
  currentYield: number; // decimal, e.g. 0.035 = 3.5%
  historicalGrowthRates: number[];
}

export interface BenchmarkResult {
  ticker: string;
  currentAnnualIncome: number;
  p10At20y: number;
  p50At20y: number;
  p90At20y: number;
}

/**
 * Compute benchmark current and 20-year MC-projected income for a given
 * dollar allocation in each benchmark.
 */
export function benchmarkAllocation(
  totalDollars: number,
  benchmarks: BenchmarkInput[],
  opts: { horizonYears?: number; paths?: number; seed?: number } = {},
): BenchmarkResult[] {
  const horizon = opts.horizonYears ?? 20;
  return benchmarks.map((b) => {
    const currentAnnualIncome = totalDollars * b.currentYield;
    const mc = runMonteCarlo(
      [
        {
          ticker: b.ticker,
          currentAnnualIncome,
          historicalGrowthRates: b.historicalGrowthRates,
        } satisfies HoldingForecastInput,
      ],
      { horizonYears: horizon, paths: opts.paths ?? 10_000, seed: opts.seed ?? 1337 },
    );
    const last = mc.perYear[mc.perYear.length - 1]!;
    return {
      ticker: b.ticker,
      currentAnnualIncome,
      p10At20y: last.p10,
      p50At20y: last.p50,
      p90At20y: last.p90,
    };
  });
}

/**
 * Default benchmark inputs for SCHD/VYM/SPY using long-term observed yields
 * and CAGRs. These can be overridden once we wire this up to live yfinance
 * data. Numbers are conservative starting points based on historical
 * 10-year averages through ~2025.
 */
export const DEFAULT_BENCHMARKS: BenchmarkInput[] = [
  {
    ticker: 'SCHD',
    currentYield: 0.037,
    // SCHD trailing 10y dividend CAGR has been ~12%; we'll use noisy growth
    historicalGrowthRates: [0.13, 0.11, 0.14, 0.08, 0.17, 0.13, 0.12, 0.04, 0.13, 0.05],
  },
  {
    ticker: 'VYM',
    currentYield: 0.029,
    historicalGrowthRates: [0.07, 0.09, 0.06, 0.04, 0.07, 0.08, 0.05, 0.03, 0.08, 0.06],
  },
  {
    ticker: 'SPY',
    currentYield: 0.013,
    historicalGrowthRates: [0.07, 0.08, 0.06, 0.05, 0.06, 0.08, 0.06, 0.04, 0.05, 0.06],
  },
];
