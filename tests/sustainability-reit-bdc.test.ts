import { describe, expect, test } from 'bun:test';

import { scoreSustainability } from '../src/analytics/sustainability.ts';

describe('sustainability — securityKind', () => {
  test('REIT with high GAAP payout (Realty Income style) does NOT score in cut zone', () => {
    // Realty Income's GAAP payout looks like 275% because EPS is depressed
    // by depreciation. AFFO payout is closer to 75%. We approximate AFFO
    // with FCF cover. With kind='reit' the GAAP payout component is zeroed.
    const stockBased = scoreSustainability({
      payoutRatio: 2.75,
      fcfPayoutRatio: 0.85,
      growthStreakYears: 30,
      debtToEquity: 1.2,
    });
    const reitBased = scoreSustainability({
      payoutRatio: 2.75,
      fcfPayoutRatio: 0.85,
      growthStreakYears: 30,
      debtToEquity: 1.2,
      securityKind: 'reit',
    });
    // Stock-mode treats this as cut-risk (low score because the GAAP
    // payout zero-weighted at 35%). REIT-mode should give a meaningfully
    // higher score because the misleading payout is dropped and the
    // weight rolls onto FCF cover (which at 0.85 is moderate, not
    // catastrophic). Concrete numbers: stock=40.8, reit=54.8 — a +14
    // point lift purely from kind disambiguation.
    expect(stockBased.total).toBeLessThan(reitBased.total);
    expect(reitBased.total - stockBased.total).toBeGreaterThanOrEqual(10);
    expect(reitBased.total).toBeGreaterThanOrEqual(50);
    // REIT warning is present
    expect(reitBased.warnings.some((w) => w.includes('REIT'))).toBe(true);
    // Payout component weight is shifted to FCF cover (35 + 35 = 70%)
    expect(reitBased.components.payout.weight).toBe(0);
    expect(reitBased.components.fcfCover.weight).toBeCloseTo(0.7, 3);
  });

  test('BDC with high GAAP payout does NOT score in cut zone', () => {
    const bdc = scoreSustainability({
      payoutRatio: 1.05,
      fcfPayoutRatio: 0.78,
      growthStreakYears: 5,
      debtToEquity: 0.9,
      securityKind: 'bdc',
    });
    expect(bdc.warnings.some((w) => w.includes('BDC'))).toBe(true);
    // Should be moderate, not catastrophic. Without the kind hint, the
    // GAAP 1.05x payout would zero out 35% of the score.
    expect(bdc.total).toBeGreaterThanOrEqual(50);
  });

  test('ETF with no payout ratio data scores normally on FCF + streak', () => {
    const etf = scoreSustainability({
      payoutRatio: null,
      fcfPayoutRatio: 0.4,
      growthStreakYears: 14,
      debtToEquity: null,
      securityKind: 'etf',
    });
    // For ETFs we don't emit a "REIT" warning
    expect(etf.warnings.some((w) => w.includes('REIT'))).toBe(false);
    expect(etf.warnings.some((w) => w.includes('BDC'))).toBe(false);
    // Should not get the "no growth streak" warning either if streak > 0
    expect(etf.warnings.some((w) => w.includes('growth streak'))).toBe(false);
    expect(etf.components.payout.weight).toBe(0);
  });

  test('MLP with absurd FCF payout (K-1 artifact) is treated as data noise, not catastrophe', () => {
    // EPD-style: yfinance reports FCF payout of 21,132% because MLPs
    // report DCF (distributable cash flow) under partnership accounting,
    // and yfinance's FCF figure is essentially noise (D&A-heavy K-1).
    // Without the MLP hint, the scorer would treat 211x FCF payout as a
    // hard zero — dominating ~70% of the score and turning a 19y-streak
    // payer into a 17/100 score.
    const noisyFcf = scoreSustainability({
      payoutRatio: 0.81,
      fcfPayoutRatio: 211.32, // garbage K-1 artifact
      growthStreakYears: 19,
      debtToEquity: 1.14,
      securityKind: 'mlp',
    });
    // BDC-mode (the old behaviour we used to apply to MLPs) would zero
    // the FCF cover and produce a catastrophic score.
    const bdcMode = scoreSustainability({
      payoutRatio: 0.81,
      fcfPayoutRatio: 211.32,
      growthStreakYears: 19,
      debtToEquity: 1.14,
      securityKind: 'bdc',
    });
    // MLP-mode should score meaningfully higher because the noisy FCF
    // is clamped to "unknown" rather than scored as a 0.
    expect(noisyFcf.total).toBeGreaterThan(bdcMode.total);
    expect(noisyFcf.total - bdcMode.total).toBeGreaterThanOrEqual(10);
    // MLP warning surfaces the K-1 explanation
    expect(noisyFcf.warnings.some((w) => w.includes('MLP'))).toBe(true);
    // But the misleading "paying more than free cash flow" warning is
    // suppressed for MLPs.
    expect(noisyFcf.warnings.some((w) => w.includes('paying more than free cash flow'))).toBe(
      false,
    );
    // GAAP payout is still disabled for MLPs
    expect(noisyFcf.components.payout.weight).toBe(0);
    expect(noisyFcf.components.fcfCover.weight).toBeCloseTo(0.7, 3);
  });

  test('MLP with plausible FCF payout (≤5x) is scored normally', () => {
    // ET-style with hypothetically clean FCF data — should still be
    // treated like a BDC: GAAP payout disabled, FCF cover weighted up.
    const cleanMlp = scoreSustainability({
      payoutRatio: 1.05,
      fcfPayoutRatio: 0.85,
      growthStreakYears: 4,
      debtToEquity: 1.4,
      securityKind: 'mlp',
    });
    expect(cleanMlp.warnings.some((w) => w.includes('MLP'))).toBe(true);
    // FCF score path runs normally because the ratio is below the noise
    // threshold (5.0).
    expect(cleanMlp.components.fcfCover.score).toBeGreaterThan(0);
  });

  test('default (no kind) preserves legacy stock behaviour', () => {
    const before = scoreSustainability({
      payoutRatio: 0.6,
      fcfPayoutRatio: 0.5,
      growthStreakYears: 10,
      debtToEquity: 0.8,
    });
    const stock = scoreSustainability({
      payoutRatio: 0.6,
      fcfPayoutRatio: 0.5,
      growthStreakYears: 10,
      debtToEquity: 0.8,
      securityKind: 'stock',
    });
    expect(stock.total).toBeCloseTo(before.total, 2);
  });
});
