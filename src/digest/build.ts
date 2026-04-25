/**
 * Weekly digest builder.
 *
 * Produces a Markdown report from the database. Tries to be useful even
 * when fundamentals data is incomplete.
 */

import type { Database } from 'bun:sqlite';

import { type Warning, detectCutWarnings } from '../analytics/cut-warnings.ts';
import { aggregatePortfolio, aggregateTtmDividends } from '../analytics/portfolio.ts';
import { scoreSustainability } from '../analytics/sustainability.ts';
import { DEFAULT_BENCHMARKS, benchmarkAllocation } from '../forecast/benchmarks.ts';
import {
  type HoldingForecastInput,
  dpsHistoryToGrowthRates,
  runMonteCarlo,
} from '../forecast/monte-carlo.ts';
import { formatUsd } from '../lib/money.ts';

export interface DigestOptions {
  asOfDate?: string;
  /** Cap rows per section. */
  maxRows?: number;
  /** Include the experimental MC projection. */
  includeMonteCarlo?: boolean;
}

export function buildDigest(db: Database, opts: DigestOptions = {}): string {
  const today = opts.asOfDate ?? new Date().toISOString().slice(0, 10);
  const maxRows = opts.maxRows ?? 10;
  const includeMc = opts.includeMonteCarlo ?? true;

  const portfolio = aggregatePortfolio(db, today);
  const ttm = aggregateTtmDividends(db, today);
  const ttmByTicker = new Map(ttm.map((r) => [r.ticker, r]));

  if (portfolio.length === 0) {
    return `# 📊 dividend-dash weekly digest — ${today}\n\nNo holdings ingested yet. Run \`bun run ingest -- --broker=<name> --file=<path>\` to get started.`;
  }

  const totalCost = portfolio.reduce((acc, r) => acc + r.totalCostBasisCents, 0);
  const totalTtm = ttm.reduce((acc, r) => acc + r.ttmAmountCents, 0);

  const lines: string[] = [];
  lines.push(`# 📊 dividend-dash weekly digest — ${today}`);
  lines.push('');
  lines.push(
    `**Portfolio:** ${formatUsd(totalCost)} cost basis · ${portfolio.length} positions across ${
      new Set(portfolio.flatMap((r) => r.brokers)).size
    } broker(s)`,
  );
  lines.push(
    `**TTM dividend income:** ${formatUsd(totalTtm)} (${
      totalCost > 0 ? ((totalTtm / totalCost) * 100).toFixed(2) : '0.00'
    }% YOC)`,
  );
  lines.push('');

  // === Top dividend earners ===
  lines.push('## 💰 Top dividend earners (TTM)');
  lines.push('');
  if (ttm.length === 0) {
    lines.push('_No dividend transactions ingested yet._');
  } else {
    lines.push('| Ticker | TTM Income | Payments |');
    lines.push('|--------|-----------:|---------:|');
    for (const r of ttm.slice(0, maxRows)) {
      lines.push(`| ${r.ticker} | ${formatUsd(r.ttmAmountCents)} | ${r.paymentCount} |`);
    }
  }
  lines.push('');

  // === Sustainability scorecard (works without fundamentals — null inputs) ===
  lines.push('## 🛡️  Sustainability scorecard');
  lines.push('');
  lines.push('| Ticker | Score | Top warnings |');
  lines.push('|--------|------:|--------------|');
  const scorecard: { ticker: string; score: number; warnings: string[] }[] = [];
  for (const row of portfolio.slice(0, maxRows)) {
    const f = readFundamentals(db, row.ticker);
    const score = scoreSustainability({
      payoutRatio: f.payoutRatio,
      fcfPayoutRatio: f.fcfPayoutRatio,
      growthStreakYears: f.dividendGrowthStreakYears ?? 0,
      debtToEquity: f.debtToEquity,
    });
    scorecard.push({ ticker: row.ticker, score: score.total, warnings: score.warnings });
    const w = score.warnings.length === 0 ? '—' : score.warnings.slice(0, 2).join('; ');
    lines.push(`| ${row.ticker} | ${score.total.toFixed(1)} | ${w} |`);
  }
  lines.push('');

  // === Cut warnings ===
  const allWarnings: Warning[] = [];
  for (const row of portfolio) {
    const f = readFundamentals(db, row.ticker);
    const dpsHistory = readAnnualDpsHistory(db, row.ticker, 8);
    const ws = detectCutWarnings({
      ticker: row.ticker,
      payoutRatio: f.payoutRatio,
      fcfPayoutRatio: f.fcfPayoutRatio,
      growthStreakYears: f.dividendGrowthStreakYears ?? 0,
      annualDpsHistory: dpsHistory,
      debtToEquity: f.debtToEquity,
    });
    allWarnings.push(...ws);
  }
  if (allWarnings.length > 0) {
    lines.push('## ⚠️  Cut early warnings');
    lines.push('');
    for (const w of allWarnings) {
      const icon = w.severity === 'red' ? '🔴' : w.severity === 'amber' ? '🟠' : '🟡';
      lines.push(`- ${icon} ${w.message}`);
    }
    lines.push('');
  }

  // === Monte Carlo forward income ===
  if (includeMc) {
    const forecastInputs: HoldingForecastInput[] = [];
    for (const row of portfolio) {
      const ttmRow = ttmByTicker.get(row.ticker);
      const annualIncome = (ttmRow?.ttmAmountCents ?? 0) / 100;
      if (annualIncome <= 0) continue;
      const dpsHistory = readAnnualDpsHistory(db, row.ticker, 10);
      const growthRates = dpsHistoryToGrowthRates(dpsHistory);
      forecastInputs.push({
        ticker: row.ticker,
        currentAnnualIncome: annualIncome,
        historicalGrowthRates: growthRates.length > 0 ? growthRates : [0.04, 0.05, 0.06, 0.04],
      });
    }
    if (forecastInputs.length > 0) {
      const mc = runMonteCarlo(forecastInputs, { horizonYears: 20, paths: 5000, seed: 1337 });
      lines.push('## 🔮 Forward dividend income (Monte Carlo, 5000 paths)');
      lines.push('');
      lines.push('| Year | P10 | P50 | P90 |');
      lines.push('|----:|-----:|-----:|-----:|');
      for (const yr of [1, 5, 10, 20]) {
        const point = mc.perYear[yr - 1];
        if (!point) continue;
        lines.push(
          `| ${yr} | $${point.p10.toFixed(0)} | $${point.p50.toFixed(0)} | $${point.p90.toFixed(0)} |`,
        );
      }
      lines.push('');

      // Benchmark comparison
      const totalDollars = totalCost / 100;
      const benches = benchmarkAllocation(totalDollars, DEFAULT_BENCHMARKS, {
        horizonYears: 20,
        seed: 1337,
      });
      lines.push('## 🎯 Benchmark vs your portfolio (20y projection)');
      lines.push('');
      lines.push(
        `**Your $ allocation if held in benchmarks** (current ${formatUsd(totalCost)} basis):`,
      );
      lines.push('');
      lines.push('| Benchmark | Today | P50 @ 20y | P90 @ 20y |');
      lines.push('|----------|------:|---------:|---------:|');
      for (const b of benches) {
        lines.push(
          `| ${b.ticker} | $${b.currentAnnualIncome.toFixed(0)} | $${b.p50At20y.toFixed(0)} | $${b.p90At20y.toFixed(0)} |`,
        );
      }
      lines.push(
        `| **You (actual)** | **$${(totalTtm / 100).toFixed(0)}** | **$${mc.perYear[19]?.p50.toFixed(0) ?? '—'}** | **$${mc.perYear[19]?.p90.toFixed(0) ?? '—'}** |`,
      );
      lines.push('');
    }
  }

  lines.push('---');
  lines.push(
    `_Generated by [dividend-dash](https://github.com/forward1019/dividend-dash) · ${today}_`,
  );

  return lines.join('\n');
}

interface Fundamentals {
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  dividendGrowthStreakYears: number | null;
}

function readFundamentals(db: Database, ticker: string): Fundamentals {
  const row = db
    .query<
      {
        payout_ratio: number | null;
        fcf_payout_ratio: number | null;
        debt_to_equity: number | null;
        dividend_growth_streak_years: number | null;
      },
      [string]
    >(
      `SELECT payout_ratio, fcf_payout_ratio, debt_to_equity, dividend_growth_streak_years
       FROM fundamentals
       WHERE ticker = ?
       ORDER BY as_of_date DESC LIMIT 1`,
    )
    .get(ticker);
  return {
    payoutRatio: row?.payout_ratio ?? null,
    fcfPayoutRatio: row?.fcf_payout_ratio ?? null,
    debtToEquity: row?.debt_to_equity ?? null,
    dividendGrowthStreakYears: row?.dividend_growth_streak_years ?? null,
  };
}

function readAnnualDpsHistory(db: Database, ticker: string, years: number): number[] {
  // Sum per-year dividend events from dividend_events table
  const rows = db
    .query<{ year: string; total_micros: number }, [string]>(
      `SELECT substr(ex_date, 1, 4) AS year,
              SUM(amount_per_share_micros) AS total_micros
       FROM dividend_events
       WHERE ticker = ?
       GROUP BY year
       ORDER BY year`,
    )
    .all(ticker);
  const last = rows.slice(-years);
  return last.map((r) => r.total_micros / 1_000_000);
}
