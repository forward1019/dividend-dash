import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_WEIGHTS,
  scoreDebtEquity,
  scoreFcfCover,
  scoreGrowthStreak,
  scorePayoutRatio,
  scoreSustainability,
} from '../src/analytics/sustainability.ts';

describe('scorePayoutRatio', () => {
  test('low payout = high score', () => {
    expect(scorePayoutRatio(0.2)).toBe(100);
    expect(scorePayoutRatio(0.3)).toBe(100);
  });

  test('moderate payout = moderate score', () => {
    expect(scorePayoutRatio(0.5)).toBe(85);
    expect(scorePayoutRatio(0.7)).toBeCloseTo(60, 1);
  });

  test('high payout = low score', () => {
    expect(scorePayoutRatio(0.9)).toBe(25);
    expect(scorePayoutRatio(1.0)).toBe(0);
  });

  test('negative payout (paying out of losses)', () => {
    expect(scorePayoutRatio(-0.1)).toBe(0);
  });

  test('null = penalize but not zero', () => {
    expect(scorePayoutRatio(null)).toBe(25);
  });
});

describe('scoreFcfCover', () => {
  test('null FCF = heavy penalty', () => {
    expect(scoreFcfCover(null)).toBe(20);
  });

  test('over 100% = zero', () => {
    expect(scoreFcfCover(1.5)).toBe(0);
  });

  test('safe FCF cover = high score', () => {
    expect(scoreFcfCover(0.3)).toBe(100);
  });
});

describe('scoreGrowthStreak', () => {
  test('Aristocrat (25y)', () => {
    expect(scoreGrowthStreak(25)).toBe(100);
    expect(scoreGrowthStreak(50)).toBe(100);
  });

  test('zero streak = 30', () => {
    expect(scoreGrowthStreak(0)).toBe(30);
  });

  test('5y mid', () => {
    expect(scoreGrowthStreak(5)).toBe(60);
  });
});

describe('scoreDebtEquity', () => {
  test('low debt = high score', () => {
    expect(scoreDebtEquity(0.3)).toBe(100);
  });

  test('extreme leverage = zero', () => {
    expect(scoreDebtEquity(5)).toBe(0);
  });

  test('null = neutral', () => {
    expect(scoreDebtEquity(null)).toBe(50);
  });
});

describe('scoreSustainability', () => {
  test('aristocrat profile scores near top', () => {
    const r = scoreSustainability({
      payoutRatio: 0.4,
      fcfPayoutRatio: 0.5,
      growthStreakYears: 30,
      debtToEquity: 0.6,
    });
    expect(r.total).toBeGreaterThan(85);
    expect(r.warnings).toHaveLength(0);
  });

  test('cut-risk profile scores low and emits warnings', () => {
    const r = scoreSustainability({
      payoutRatio: 0.95,
      fcfPayoutRatio: 1.2,
      growthStreakYears: 0,
      debtToEquity: 5,
    });
    expect(r.total).toBeLessThan(20);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
    expect(r.warnings.join(' ')).toContain('Payout ratio');
    expect(r.warnings.join(' ')).toContain('FCF payout ratio');
  });

  test('weights sum to 1', () => {
    const total =
      DEFAULT_WEIGHTS.payout +
      DEFAULT_WEIGHTS.fcfCover +
      DEFAULT_WEIGHTS.growthStreak +
      DEFAULT_WEIGHTS.debtEquity;
    expect(total).toBeCloseTo(1, 6);
  });
});
