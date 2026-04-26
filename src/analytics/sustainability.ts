/**
 * Sustainability scorecard. Produces a 0-100 score per holding combining:
 *   - Payout ratio (lower better) — 35%
 *   - FCF cover (higher better) — 35%
 *   - Dividend growth streak (longer better) — 20%
 *   - Debt/equity (lower better) — 10%
 *
 * Weights are documented in docs/decisions.md and are easily tunable.
 *
 * Each component is normalized to [0, 100] using piecewise-linear mappings
 * calibrated against the academic literature on dividend cut prediction
 * (Lintner 1956, Brav et al 2005). The mappings are intentionally simple so
 * they're easy to reason about and tune later.
 */

export interface SustainabilityInputs {
  /** dividends / earnings; null if loss or unknown. */
  payoutRatio: number | null;
  /** dividends / FCF; null if FCF <= 0 or unknown. */
  fcfPayoutRatio: number | null;
  /** Consecutive years of non-decreasing DPS. */
  growthStreakYears: number;
  /** Total debt / equity; null if unknown. */
  debtToEquity: number | null;
  /**
   * Issuer kind. REITs and BDCs report GAAP earnings depressed by D&A
   * (REITs) or one-time investment-loss accruals (BDCs), so a payout
   * ratio computed against GAAP EPS is structurally misleading. When
   * `securityKind` is 'reit' or 'bdc', the GAAP payout component is
   * disabled and its weight is shifted onto FCF cover, which is a
   * cleaner proxy for distributable cash. ETFs pass-through dividends
   * and have no payout ratio at all — same treatment.
   * Default 'stock' preserves legacy behaviour.
   */
  securityKind?: 'stock' | 'etf' | 'reit' | 'bdc';
}

export interface SustainabilityScore {
  total: number; // 0-100
  components: {
    payout: { score: number; weight: number };
    fcfCover: { score: number; weight: number };
    growthStreak: { score: number; weight: number };
    debtEquity: { score: number; weight: number };
  };
  warnings: string[];
}

export interface ScoreWeights {
  payout: number;
  fcfCover: number;
  growthStreak: number;
  debtEquity: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  payout: 0.35,
  fcfCover: 0.35,
  growthStreak: 0.2,
  debtEquity: 0.1,
};

/**
 * Score a payout ratio (dividends / earnings).
 *   ≤ 30%  → 100 (very safe)
 *   30-50%  → linear 100 → 85
 *   50-70%  → linear 85 → 60
 *   70-90%  → linear 60 → 25
 *   ≥ 90%  → 0  (cut zone)
 *   negative or null (loss / unknown) → 25 (penalize but don't zero)
 */
export function scorePayoutRatio(ratio: number | null): number {
  if (ratio === null) return 25;
  if (ratio < 0) return 0; // paying dividends out of losses
  if (ratio <= 0.3) return 100;
  if (ratio <= 0.5) return lerp(ratio, 0.3, 0.5, 100, 85);
  if (ratio <= 0.7) return lerp(ratio, 0.5, 0.7, 85, 60);
  if (ratio <= 0.9) return lerp(ratio, 0.7, 0.9, 60, 25);
  return 0;
}

/**
 * Score FCF payout ratio (dividends / FCF). Same shape as payout ratio but
 * FCF is a cleaner signal — no accruals games.
 */
export function scoreFcfCover(ratio: number | null): number {
  if (ratio === null) return 20; // negative FCF hidden as null
  if (ratio < 0) return 0;
  if (ratio <= 0.3) return 100;
  if (ratio <= 0.5) return lerp(ratio, 0.3, 0.5, 100, 85);
  if (ratio <= 0.7) return lerp(ratio, 0.5, 0.7, 85, 60);
  if (ratio <= 1.0) return lerp(ratio, 0.7, 1.0, 60, 20);
  return 0;
}

/**
 * Score the growth streak in years.
 *   0  → 30  (no track record but not auto-fail)
 *   5  → 60
 *   10 → 80
 *   25+ → 100 (Dividend Aristocrat territory)
 */
export function scoreGrowthStreak(years: number): number {
  if (years <= 0) return 30;
  if (years >= 25) return 100;
  if (years <= 5) return lerp(years, 0, 5, 30, 60);
  if (years <= 10) return lerp(years, 5, 10, 60, 80);
  return lerp(years, 10, 25, 80, 100);
}

/**
 * Score debt/equity. Reasonable thresholds vary by sector — this is a
 * cross-sector default. REITs and utilities will look worse than they are.
 *   ≤ 0.5 → 100
 *   0.5–1.0 → 100 → 75
 *   1.0–2.0 → 75 → 40
 *   2.0–4.0 → 40 → 10
 *   > 4.0 → 0
 */
export function scoreDebtEquity(de: number | null): number {
  if (de === null) return 50; // unknown → middle of the road
  if (de < 0) return 50; // negative equity is its own problem; flag separately
  if (de <= 0.5) return 100;
  if (de <= 1.0) return lerp(de, 0.5, 1.0, 100, 75);
  if (de <= 2.0) return lerp(de, 1.0, 2.0, 75, 40);
  if (de <= 4.0) return lerp(de, 2.0, 4.0, 40, 10);
  return 0;
}

export function scoreSustainability(
  inputs: SustainabilityInputs,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): SustainabilityScore {
  const kind = inputs.securityKind ?? 'stock';
  // REITs / BDCs / ETFs: GAAP payout ratio is meaningless. Disable the
  // payout component and reweight onto FCF cover (the closest free
  // proxy for distributable cash without pulling AFFO/NII from EDGAR).
  const disablePayout = kind === 'reit' || kind === 'bdc' || kind === 'etf';
  const effectiveWeights: ScoreWeights = disablePayout
    ? {
        payout: 0,
        fcfCover: weights.fcfCover + weights.payout,
        growthStreak: weights.growthStreak,
        debtEquity: weights.debtEquity,
      }
    : weights;

  const payoutScore = disablePayout ? 0 : scorePayoutRatio(inputs.payoutRatio);
  const fcfScore = scoreFcfCover(inputs.fcfPayoutRatio);
  const streakScore = scoreGrowthStreak(inputs.growthStreakYears);
  const deScore = scoreDebtEquity(inputs.debtToEquity);

  const total =
    payoutScore * effectiveWeights.payout +
    fcfScore * effectiveWeights.fcfCover +
    streakScore * effectiveWeights.growthStreak +
    deScore * effectiveWeights.debtEquity;

  const warnings: string[] = [];
  if (disablePayout) {
    if (kind === 'reit') {
      warnings.push('REIT — GAAP payout ratio not applicable (use AFFO; FCF cover is a proxy)');
    } else if (kind === 'bdc') {
      warnings.push('BDC — GAAP payout ratio not applicable (use NII; FCF cover is a proxy)');
    }
    // For ETFs we silently omit the warning — pass-through is normal.
  } else if (inputs.payoutRatio !== null && inputs.payoutRatio > 0.9) {
    warnings.push(`Payout ratio ${(inputs.payoutRatio * 100).toFixed(1)}% — at or above cut zone`);
  }
  if (inputs.fcfPayoutRatio !== null && inputs.fcfPayoutRatio > 1.0) {
    warnings.push(
      `FCF payout ratio ${(inputs.fcfPayoutRatio * 100).toFixed(1)}% — paying more than free cash flow`,
    );
  }
  if (inputs.fcfPayoutRatio === null) {
    warnings.push('FCF cover unknown — may indicate negative or near-zero free cash flow');
  }
  if (inputs.debtToEquity !== null && inputs.debtToEquity > 4) {
    warnings.push(`Debt/equity ${inputs.debtToEquity.toFixed(2)} — heavy leverage`);
  }
  if (inputs.growthStreakYears === 0 && kind === 'stock') {
    warnings.push('No dividend growth streak yet');
  }

  return {
    total: Math.round(total * 10) / 10,
    components: {
      payout: { score: payoutScore, weight: effectiveWeights.payout },
      fcfCover: { score: fcfScore, weight: effectiveWeights.fcfCover },
      growthStreak: { score: streakScore, weight: effectiveWeights.growthStreak },
      debtEquity: { score: deScore, weight: effectiveWeights.debtEquity },
    },
    warnings,
  };
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}
