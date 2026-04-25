import { describe, expect, test } from 'bun:test';

import {
  type DividendEventInput,
  annualDividendPerShare,
  detectFrequency,
  dividendCagr,
  forwardYield,
  growthStreakYears,
  trailingYield,
  ttmDividendPerShare,
} from '../src/analytics/dividend-stats.ts';

/** Build a quarterly dividend stream from `startYear` to `endYear` inclusive. */
function quarterlyDivs(
  startYear: number,
  endYear: number,
  amountPerShareCents: number,
): DividendEventInput[] {
  const out: DividendEventInput[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const m of ['03', '06', '09', '12']) {
      out.push({ exDate: `${y}-${m}-15`, amountPerShareMicros: amountPerShareCents * 10_000 });
    }
  }
  return out;
}

/** Quarterly dividend stream with 5%/yr growth. */
function growingQuarterly(
  startYear: number,
  endYear: number,
  startCents: number,
  growthPct: number,
): DividendEventInput[] {
  const out: DividendEventInput[] = [];
  let cur = startCents;
  for (let y = startYear; y <= endYear; y++) {
    for (const m of ['03', '06', '09', '12']) {
      out.push({ exDate: `${y}-${m}-15`, amountPerShareMicros: Math.round(cur * 10_000) });
    }
    cur *= 1 + growthPct / 100;
  }
  return out;
}

describe('detectFrequency', () => {
  test('detects quarterly', () => {
    expect(detectFrequency(quarterlyDivs(2024, 2026, 25))).toBe('quarterly');
  });

  test('detects monthly', () => {
    const monthly: DividendEventInput[] = [];
    for (let m = 1; m <= 24; m++) {
      const d = new Date(2024, m - 1, 15);
      monthly.push({
        exDate: d.toISOString().slice(0, 10),
        amountPerShareMicros: 100_000,
      });
    }
    expect(detectFrequency(monthly)).toBe('monthly');
  });

  test('detects annual', () => {
    const annual: DividendEventInput[] = [];
    for (let y = 2018; y <= 2026; y++) {
      annual.push({ exDate: `${y}-06-15`, amountPerShareMicros: 1_000_000 });
    }
    expect(detectFrequency(annual)).toBe('annual');
  });

  test('returns unknown for too few events', () => {
    expect(detectFrequency([])).toBe('unknown');
    expect(detectFrequency([{ exDate: '2026-01-01', amountPerShareMicros: 100_000 }])).toBe(
      'unknown',
    );
  });
});

describe('annualDividendPerShare', () => {
  test('sums quarterly dividends in the year', () => {
    const events = quarterlyDivs(2025, 2025, 25); // 4 × $0.25 = $1.00
    expect(annualDividendPerShare(events, 2025)).toBeCloseTo(1.0, 4);
  });

  test('returns 0 for years with no dividends', () => {
    const events = quarterlyDivs(2025, 2025, 25);
    expect(annualDividendPerShare(events, 2024)).toBe(0);
  });
});

describe('ttmDividendPerShare', () => {
  test('sums dividends in the trailing 12 months', () => {
    const events = quarterlyDivs(2024, 2026, 25);
    // As of 2026-04-25, TTM is dividends after 2025-04-25 through 2026-04-25
    // = 2025-06, 2025-09, 2025-12, 2026-03 = 4 × $0.25
    expect(ttmDividendPerShare(events, '2026-04-25')).toBeCloseTo(1.0, 4);
  });
});

describe('dividendCagr', () => {
  test('computes compounded growth correctly', () => {
    // 5%/yr growth over 5 years
    const events = growingQuarterly(2020, 2025, 25, 5);
    const cagr = dividendCagr(events, 5);
    expect(cagr).not.toBeNull();
    expect(cagr!).toBeCloseTo(0.05, 2);
  });

  test('returns null when start year has zero dividend', () => {
    const events = quarterlyDivs(2025, 2026, 25);
    expect(dividendCagr(events, 5)).toBeNull();
  });
});

describe('growthStreakYears', () => {
  test('counts consecutive growing years ending in last complete year', () => {
    // 2020-2025 growing 5%/yr. As of 2026-04, last complete year = 2025.
    // Years: 2020 < 2021 < 2022 < 2023 < 2024 < 2025 → streak = 5
    const events = growingQuarterly(2020, 2025, 25, 5);
    expect(growthStreakYears(events, '2026-04-25')).toBe(5);
  });

  test('returns 0 for flat dividends', () => {
    const events = quarterlyDivs(2020, 2025, 25);
    expect(growthStreakYears(events, '2026-04-25')).toBe(0);
  });

  test('breaks streak at first decrease', () => {
    const events = [
      ...quarterlyDivs(2020, 2020, 20), // $0.80
      ...quarterlyDivs(2021, 2021, 22), // $0.88 (up)
      ...quarterlyDivs(2022, 2022, 24), // $0.96 (up)
      ...quarterlyDivs(2023, 2023, 22), // $0.88 (DOWN — break)
      ...quarterlyDivs(2024, 2024, 25), // $1.00 (up)
      ...quarterlyDivs(2025, 2025, 27), // $1.08 (up)
    ];
    expect(growthStreakYears(events, '2026-04-25')).toBe(2); // 2024, 2025
  });
});

describe('forwardYield', () => {
  test('quarterly: latest × 4 / price', () => {
    const events = quarterlyDivs(2024, 2026, 25); // latest = $0.25
    // Annualized = $1.00. Price = $50 → 2%
    expect(forwardYield(events, 5000)).toBeCloseTo(0.02, 4);
  });

  test('returns null for zero price', () => {
    expect(forwardYield(quarterlyDivs(2024, 2026, 25), 0)).toBeNull();
  });
});

describe('trailingYield', () => {
  test('TTM DPS / price', () => {
    const events = quarterlyDivs(2024, 2026, 25);
    // TTM DPS as of 2026-04 ≈ $1.00, price $50 → 2%
    const y = trailingYield(events, 5000);
    expect(y).toBeCloseTo(0.02, 2);
  });
});
