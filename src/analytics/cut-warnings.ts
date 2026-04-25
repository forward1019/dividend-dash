/**
 * Dividend cut early warning rules engine.
 *
 * Each rule looks at fundamentals + recent dividend behavior and emits a
 * warning if it fires. Rules are conservative: false positives hurt user
 * confidence less than false negatives (missed cuts).
 *
 * Rule severity:
 *   - red:    historically ~50%+ of cuts within 12 months
 *   - amber:  watchlist signal, ~20-30% cut rate
 *   - yellow: noisy signal, ~10% cut rate
 */

export type WarningSeverity = 'red' | 'amber' | 'yellow';

export interface Warning {
  rule: string;
  severity: WarningSeverity;
  message: string;
  evidence: Record<string, unknown>;
}

export interface WarningInputs {
  ticker: string;
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  /** Consecutive years of non-decreasing DPS. */
  growthStreakYears: number;
  /** Calendar-year DPS for the last 4-8 years, oldest first. */
  annualDpsHistory: number[];
  /** Debt/equity ratio. */
  debtToEquity: number | null;
}

export function detectCutWarnings(inputs: WarningInputs): Warning[] {
  const warnings: Warning[] = [];

  // RULE 1: Payout ratio above 90%
  if (inputs.payoutRatio !== null && inputs.payoutRatio > 0.9) {
    warnings.push({
      rule: 'payout_ratio_critical',
      severity: 'red',
      message: `${inputs.ticker}: payout ratio ${(inputs.payoutRatio * 100).toFixed(1)}% exceeds 90% — historically high cut probability`,
      evidence: { payoutRatio: inputs.payoutRatio },
    });
  }

  // RULE 2: FCF cover insufficient
  if (inputs.fcfPayoutRatio !== null && inputs.fcfPayoutRatio > 1.0) {
    warnings.push({
      rule: 'fcf_underwater',
      severity: 'red',
      message: `${inputs.ticker}: paying out ${(inputs.fcfPayoutRatio * 100).toFixed(1)}% of free cash flow — unsustainable`,
      evidence: { fcfPayoutRatio: inputs.fcfPayoutRatio },
    });
  }

  // RULE 3: FCF unknown / negative (often indicates the data source hides negative FCF)
  if (inputs.fcfPayoutRatio === null) {
    warnings.push({
      rule: 'fcf_unknown',
      severity: 'amber',
      message: `${inputs.ticker}: free cash flow cover unknown — possible negative FCF`,
      evidence: {},
    });
  }

  // RULE 4: Growth stalled for 8+ years (long-term shareholders should expect growth)
  // Look at the last 8 annual DPS values and check if they've been flat or
  // declining.
  if (inputs.annualDpsHistory.length >= 8) {
    const last8 = inputs.annualDpsHistory.slice(-8);
    const first = last8[0]!;
    const last = last8[last8.length - 1]!;
    if (first > 0 && last <= first * 1.01) {
      warnings.push({
        rule: 'growth_stalled_long',
        severity: 'amber',
        message: `${inputs.ticker}: dividend has been flat or declining for 8 years (${first.toFixed(2)} → ${last.toFixed(2)})`,
        evidence: { firstYear: first, lastYear: last, years: 8 },
      });
    }
  }

  // RULE 5: Recent DPS decrease
  if (inputs.annualDpsHistory.length >= 2) {
    const recent = inputs.annualDpsHistory.slice(-2);
    if (recent[0]! > 0 && recent[1]! < recent[0]!) {
      warnings.push({
        rule: 'recent_dps_decrease',
        severity: 'red',
        message: `${inputs.ticker}: most recent annual DPS dropped ${recent[0]!.toFixed(2)} → ${recent[1]!.toFixed(2)} — cut already in progress`,
        evidence: { previous: recent[0], current: recent[1] },
      });
    }
  }

  // RULE 6: Heavy leverage AND high payout
  if (
    inputs.debtToEquity !== null &&
    inputs.debtToEquity > 3 &&
    inputs.payoutRatio !== null &&
    inputs.payoutRatio > 0.7
  ) {
    warnings.push({
      rule: 'levered_high_payout',
      severity: 'amber',
      message: `${inputs.ticker}: debt/equity ${inputs.debtToEquity.toFixed(2)} and payout ratio ${(inputs.payoutRatio * 100).toFixed(0)}% — leveraged dividend payer`,
      evidence: {
        debtToEquity: inputs.debtToEquity,
        payoutRatio: inputs.payoutRatio,
      },
    });
  }

  // RULE 7: Decel — slowing growth (recent CAGR less than half of long-term)
  if (inputs.annualDpsHistory.length >= 6) {
    const series = inputs.annualDpsHistory;
    const longCagr = cagr(series[0]!, series[series.length - 1]!, series.length - 1);
    const recentSlice = series.slice(-3);
    const recentCagr = cagr(recentSlice[0]!, recentSlice[recentSlice.length - 1]!, 2);

    if (
      longCagr !== null &&
      recentCagr !== null &&
      longCagr > 0.05 &&
      recentCagr < longCagr * 0.5
    ) {
      warnings.push({
        rule: 'growth_decelerating',
        severity: 'yellow',
        message: `${inputs.ticker}: dividend growth decelerating — recent CAGR ${(recentCagr * 100).toFixed(1)}% vs long-term ${(longCagr * 100).toFixed(1)}%`,
        evidence: { recentCagr, longCagr },
      });
    }
  }

  return warnings;
}

function cagr(start: number, end: number, years: number): number | null {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return (end / start) ** (1 / years) - 1;
}
