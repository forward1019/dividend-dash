import { describe, expect, test } from 'bun:test';

import { detectCutWarnings } from '../src/analytics/cut-warnings.ts';

describe('detectCutWarnings', () => {
  test('healthy aristocrat profile has zero red warnings', () => {
    const ws = detectCutWarnings({
      ticker: 'JNJ',
      payoutRatio: 0.55,
      fcfPayoutRatio: 0.5,
      growthStreakYears: 60,
      annualDpsHistory: [3.6, 3.8, 4.04, 4.24, 4.45, 4.66, 4.85],
      debtToEquity: 0.5,
    });
    expect(ws.filter((w) => w.severity === 'red')).toEqual([]);
  });

  test('AT&T 2022-style profile fires red on payout AND recent decrease', () => {
    // T cut its dividend from $2.08 → $1.11 in 2022 after WBD spinoff
    const ws = detectCutWarnings({
      ticker: 'T',
      payoutRatio: 0.95, // very high
      fcfPayoutRatio: 0.85,
      growthStreakYears: 36,
      annualDpsHistory: [1.96, 2.0, 2.04, 2.08, 1.11], // CUT in last year
      debtToEquity: 1.6,
    });
    const reds = ws.filter((w) => w.severity === 'red');
    expect(reds.length).toBeGreaterThanOrEqual(2);
    expect(ws.find((w) => w.rule === 'payout_ratio_critical')).toBeDefined();
    expect(ws.find((w) => w.rule === 'recent_dps_decrease')).toBeDefined();
  });

  test('GE 2018-style profile fires fcf + recent decrease', () => {
    // GE cut from $0.96 → $0.48 → $0.04 over 2017-2018
    const ws = detectCutWarnings({
      ticker: 'GE',
      payoutRatio: null,
      fcfPayoutRatio: 1.5, // paying more than FCF
      growthStreakYears: 0,
      annualDpsHistory: [0.7, 0.82, 0.92, 0.93, 0.96, 0.96, 0.48],
      debtToEquity: 2.5,
    });
    expect(ws.find((w) => w.rule === 'fcf_underwater')).toBeDefined();
    expect(ws.find((w) => w.rule === 'recent_dps_decrease')).toBeDefined();
  });

  test('flat for 8 years fires growth_stalled_long', () => {
    const ws = detectCutWarnings({
      ticker: 'XYZ',
      payoutRatio: 0.5,
      fcfPayoutRatio: 0.4,
      growthStreakYears: 0,
      annualDpsHistory: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
      debtToEquity: 0.5,
    });
    expect(ws.find((w) => w.rule === 'growth_stalled_long')).toBeDefined();
  });

  test('levered + high payout fires amber', () => {
    const ws = detectCutWarnings({
      ticker: 'LEV',
      payoutRatio: 0.8,
      fcfPayoutRatio: 0.7,
      growthStreakYears: 5,
      annualDpsHistory: [1.5, 1.6, 1.7, 1.8],
      debtToEquity: 4,
    });
    expect(ws.find((w) => w.rule === 'levered_high_payout')).toBeDefined();
  });

  test('decelerating growth fires yellow', () => {
    const ws = detectCutWarnings({
      ticker: 'DCL',
      payoutRatio: 0.6,
      fcfPayoutRatio: 0.5,
      growthStreakYears: 6,
      annualDpsHistory: [1.0, 1.1, 1.21, 1.33, 1.46, 1.61, 1.62, 1.63],
      // long-term ~7%/yr, recent ~1%/yr → deceleration
      debtToEquity: 0.5,
    });
    expect(ws.find((w) => w.rule === 'growth_decelerating')).toBeDefined();
  });
});
