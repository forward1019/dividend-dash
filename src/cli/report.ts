#!/usr/bin/env bun
/**
 * `bun run report` — print a plain-text portfolio summary to stdout.
 */

import { aggregatePortfolio, aggregateTtmDividends } from '../analytics/portfolio.ts';
import { getDb } from '../db/db.ts';
import { formatUsd } from '../lib/money.ts';

function pad(s: string, n: number, side: 'left' | 'right' = 'right'): string {
  if (s.length >= n) return s;
  return side === 'right' ? s + ' '.repeat(n - s.length) : ' '.repeat(n - s.length) + s;
}

async function main(): Promise<void> {
  const db = getDb();

  const portfolio = aggregatePortfolio(db);
  const ttm = aggregateTtmDividends(db);
  const ttmByTicker = new Map(ttm.map((r) => [r.ticker, r]));

  console.log('=== dividend-dash portfolio ===\n');

  if (portfolio.length === 0) {
    console.log('No holdings yet. Run `bun run ingest -- --broker=<name> --file=<path>`.');
    return;
  }

  const totalCost = portfolio.reduce((acc, r) => acc + r.totalCostBasisCents, 0);
  const totalTtm = ttm.reduce((acc, r) => acc + r.ttmAmountCents, 0);

  console.log(
    `${pad('Ticker', 8)} ${pad('Shares', 10, 'left')} ${pad('Cost', 14, 'left')} ${pad(
      'TTM Div',
      12,
      'left',
    )} ${pad('Yield', 8, 'left')} ${pad('Brokers', 24)}`,
  );
  console.log('-'.repeat(80));

  for (const row of portfolio) {
    const ttmRow = ttmByTicker.get(row.ticker);
    const ttmAmt = ttmRow?.ttmAmountCents ?? 0;
    const yieldOnCost =
      row.totalCostBasisCents > 0 ? (ttmAmt / row.totalCostBasisCents) * 100 : null;

    console.log(
      `${pad(row.ticker, 8)} ${pad(row.totalShares.toFixed(4), 10, 'left')} ${pad(
        formatUsd(row.totalCostBasisCents),
        14,
        'left',
      )} ${pad(formatUsd(ttmAmt), 12, 'left')} ${pad(
        yieldOnCost !== null ? `${yieldOnCost.toFixed(2)}%` : '—',
        8,
        'left',
      )} ${pad(row.brokers.join(','), 24)}`,
    );
  }

  console.log('-'.repeat(80));
  console.log(
    `${pad('TOTAL', 8)} ${pad('', 10)} ${pad(formatUsd(totalCost), 14, 'left')} ${pad(
      formatUsd(totalTtm),
      12,
      'left',
    )} ${pad(totalCost > 0 ? `${((totalTtm / totalCost) * 100).toFixed(2)}%` : '—', 8, 'left')}`,
  );

  console.log(
    `\n${portfolio.length} positions across ${new Set(portfolio.flatMap((r) => r.brokers)).size} broker(s).`,
  );
}

if (import.meta.main) {
  await main();
}
