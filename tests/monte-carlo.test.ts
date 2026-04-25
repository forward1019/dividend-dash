import { describe, expect, test } from 'bun:test';

import {
  dpsHistoryToGrowthRates,
  fitLogNormal,
  runMonteCarlo,
} from '../src/forecast/monte-carlo.ts';
import { mulberry32 } from '../src/forecast/random.ts';

describe('mulberry32', () => {
  test('deterministic with same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test('different seeds produce different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a.next()).not.toBe(b.next());
  });

  test('normal sampler approximates mean and stddev', () => {
    const r = mulberry32(123);
    const samples: number[] = [];
    for (let i = 0; i < 50_000; i++) samples.push(r.normal(5, 2));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1);
    expect(mean).toBeCloseTo(5, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 1);
  });
});

describe('fitLogNormal', () => {
  test('zero growth rates → ~zero mu', () => {
    const fit = fitLogNormal([0, 0, 0]);
    expect(fit.mu).toBeCloseTo(0, 4);
  });

  test('5% steady growth → mu ≈ ln(1.05)', () => {
    const fit = fitLogNormal([0.05, 0.05, 0.05, 0.05]);
    expect(fit.mu).toBeCloseTo(Math.log(1.05), 4);
  });

  test('respects minStdDev floor', () => {
    const fit = fitLogNormal([0.05, 0.05, 0.05], 0.1);
    expect(fit.sigma).toBeGreaterThanOrEqual(0.1);
  });

  test('handles empty input', () => {
    const fit = fitLogNormal([]);
    expect(fit.mu).toBe(0);
    expect(fit.sigma).toBeGreaterThan(0);
  });
});

describe('runMonteCarlo', () => {
  test('deterministic with seed', () => {
    const holdings = [
      {
        ticker: 'SCHD',
        currentAnnualIncome: 1000,
        historicalGrowthRates: [0.1, 0.12, 0.08, 0.13, 0.11],
      },
    ];
    const r1 = runMonteCarlo(holdings, { horizonYears: 10, paths: 1000, seed: 7 });
    const r2 = runMonteCarlo(holdings, { horizonYears: 10, paths: 1000, seed: 7 });
    expect(r1.perYear[0]!.p50).toBe(r2.perYear[0]!.p50);
    expect(r1.perYear[9]!.p50).toBe(r2.perYear[9]!.p50);
  });

  test('p50 grows over time for positive-mean growth', () => {
    const r = runMonteCarlo(
      [
        {
          ticker: 'X',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [0.05, 0.05, 0.05, 0.05, 0.05],
        },
      ],
      { horizonYears: 10, paths: 5000, seed: 1 },
    );
    expect(r.perYear[9]!.p50).toBeGreaterThan(r.perYear[0]!.p50);
    expect(r.perYear[9]!.p50).toBeGreaterThan(1000);
  });

  test('p10 < p50 < p90 at every year', () => {
    const r = runMonteCarlo(
      [
        {
          ticker: 'X',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [-0.1, 0.05, 0.2, -0.05, 0.15],
        },
      ],
      { horizonYears: 10, paths: 5000, seed: 1 },
    );
    for (const y of r.perYear) {
      expect(y.p10).toBeLessThan(y.p50);
      expect(y.p50).toBeLessThan(y.p90);
    }
  });

  test('multi-holding portfolio sums per-path correctly', () => {
    const single = runMonteCarlo(
      [
        {
          ticker: 'X',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [0.05, 0.05, 0.05],
        },
      ],
      { horizonYears: 5, paths: 5000, seed: 99 },
    );
    const doubled = runMonteCarlo(
      [
        {
          ticker: 'X',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [0.05, 0.05, 0.05],
        },
        {
          ticker: 'Y',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [0.05, 0.05, 0.05],
        },
      ],
      { horizonYears: 5, paths: 5000, seed: 99 },
    );
    // Doubled portfolio's mean income at any year should be ~2x single's
    expect(doubled.perYear[4]!.mean).toBeGreaterThan(single.perYear[4]!.mean * 1.5);
    expect(doubled.perYear[4]!.mean).toBeLessThan(single.perYear[4]!.mean * 2.5);
  });

  test('clamps extreme growth rates', () => {
    const r = runMonteCarlo(
      [
        {
          ticker: 'X',
          currentAnnualIncome: 1000,
          historicalGrowthRates: [10, -0.95, 5, -0.5], // wild
        },
      ],
      { horizonYears: 5, paths: 1000, seed: 1, growthClamp: 0.5 },
    );
    // With clamp at +/- 50%, max possible income at year 5 = 1000 * 1.5^5 = 7593.75
    // p90 should be below that ceiling
    expect(r.perYear[4]!.p90).toBeLessThan(7600);
  });
});

describe('dpsHistoryToGrowthRates', () => {
  test('computes year-over-year growth correctly', () => {
    const rates = dpsHistoryToGrowthRates([1.0, 1.05, 1.1, 1.16]);
    expect(rates).toHaveLength(3);
    expect(rates[0]).toBeCloseTo(0.05, 4);
    expect(rates[1]).toBeCloseTo(0.0476, 3);
  });

  test('skips zero base years', () => {
    const rates = dpsHistoryToGrowthRates([0, 1.0, 1.05]);
    expect(rates).toHaveLength(1);
  });

  test('empty / single-element returns empty', () => {
    expect(dpsHistoryToGrowthRates([])).toEqual([]);
    expect(dpsHistoryToGrowthRates([1.0])).toEqual([]);
  });
});
