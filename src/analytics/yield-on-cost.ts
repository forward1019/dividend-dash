/**
 * Yield-on-cost: TTM dividend cash income divided by total cost basis,
 * computed as a time series so we can chart its evolution.
 */

import type { Database } from 'bun:sqlite';

export interface YocPoint {
  date: string;
  costBasisCents: number;
  ttmDividendCents: number;
  yieldOnCost: number; // decimal, e.g. 0.045 = 4.5%
}

/**
 * Build a quarterly YOC series for a single ticker. Cost basis at each point
 * is the most recent holding snapshot at-or-before the date. TTM dividends
 * are summed from broker-reported dividend transactions over the trailing
 * 365 days at each point.
 *
 * If the user has data for less than 1 quarter, returns an empty array.
 */
export function quarterlyYocSeries(
  db: Database,
  ticker: string,
  opts: { from?: string; to?: string } = {},
): YocPoint[] {
  const t = ticker.toUpperCase();
  const today = opts.to ?? new Date().toISOString().slice(0, 10);

  // Find the earliest holding snapshot or transaction for this ticker
  const earliest = db
    .query<{ d: string | null }, [string, string]>(
      `SELECT MIN(d) AS d FROM (
         SELECT MIN(as_of_date) AS d FROM holdings WHERE ticker = ?
         UNION ALL
         SELECT MIN(txn_date) AS d FROM transactions WHERE ticker = ?
       )`,
    )
    .get(t, t);

  if (!earliest?.d) return [];

  const start = opts.from ?? earliest.d;
  const points: YocPoint[] = [];

  let cur = new Date(start);
  // Round up to next quarter end
  cur = new Date(cur.getFullYear(), Math.floor(cur.getMonth() / 3) * 3 + 2, 30);

  const endDate = new Date(today);

  while (cur <= endDate) {
    const dateStr = cur.toISOString().slice(0, 10);

    const snap = db
      .query<{ cb: number | null }, [string, string]>(
        `SELECT SUM(cost_basis_cents) AS cb FROM (
           SELECT broker, account, ticker,
                  cost_basis_cents,
                  ROW_NUMBER() OVER (PARTITION BY broker, account ORDER BY as_of_date DESC) AS rn
           FROM holdings
           WHERE ticker = ? AND as_of_date <= ?
         ) WHERE rn = 1`,
      )
      .get(t, dateStr);

    const cb = snap?.cb ?? 0;

    const oneYearBefore = new Date(cur);
    oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
    const oneYearBeforeStr = oneYearBefore.toISOString().slice(0, 10);

    const div = db
      .query<{ ttm: number | null }, [string, string, string]>(
        `SELECT SUM(amount_cents) AS ttm FROM transactions
         WHERE ticker = ? AND txn_type = 'dividend'
         AND txn_date > ? AND txn_date <= ?`,
      )
      .get(t, oneYearBeforeStr, dateStr);

    const ttm = div?.ttm ?? 0;

    if (cb > 0) {
      points.push({
        date: dateStr,
        costBasisCents: cb,
        ttmDividendCents: ttm,
        yieldOnCost: ttm / cb,
      });
    }

    // Advance to next quarter end
    const nextMonth = cur.getMonth() + 3;
    cur = new Date(cur.getFullYear() + Math.floor(nextMonth / 12), nextMonth % 12, 30);
  }

  return points;
}
