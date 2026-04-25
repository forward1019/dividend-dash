/**
 * Portfolio aggregation: roll up holdings across brokers.
 */

import type { Database } from 'bun:sqlite';

export interface PortfolioRow {
  ticker: string;
  totalShares: number;
  totalCostBasisCents: number;
  brokerCount: number;
  brokers: string[];
}

export function aggregatePortfolio(db: Database, asOfDate?: string): PortfolioRow[] {
  // For each ticker, take the most recent snapshot per (broker, account) pair.
  // Then sum shares and cost basis across (broker, account).
  const sql = `
    WITH latest AS (
      SELECT broker, account, ticker, shares, cost_basis_cents,
             ROW_NUMBER() OVER (
               PARTITION BY broker, account, ticker
               ORDER BY as_of_date DESC, id DESC
             ) AS rn
      FROM holdings
      ${asOfDate ? 'WHERE as_of_date <= ?' : ''}
    )
    SELECT ticker,
           SUM(shares) AS totalShares,
           SUM(cost_basis_cents) AS totalCostBasisCents,
           COUNT(DISTINCT broker) AS brokerCount,
           GROUP_CONCAT(DISTINCT broker) AS brokers
    FROM latest
    WHERE rn = 1
    GROUP BY ticker
    ORDER BY totalCostBasisCents DESC
  `;

  const rows = asOfDate
    ? db
        .query<
          {
            ticker: string;
            totalShares: number;
            totalCostBasisCents: number;
            brokerCount: number;
            brokers: string;
          },
          [string]
        >(sql)
        .all(asOfDate)
    : db
        .query<
          {
            ticker: string;
            totalShares: number;
            totalCostBasisCents: number;
            brokerCount: number;
            brokers: string;
          },
          []
        >(sql)
        .all();

  return rows.map((r) => ({
    ticker: r.ticker,
    totalShares: r.totalShares,
    totalCostBasisCents: r.totalCostBasisCents,
    brokerCount: r.brokerCount,
    brokers: r.brokers.split(','),
  }));
}

export interface TtmDividendRow {
  ticker: string;
  ttmAmountCents: number;
  paymentCount: number;
  lastExDate: string | null;
}

/**
 * Trailing-twelve-month dividend cash income per ticker, based on transactions
 * (broker-reported dividend payments in your account). This is *received*
 * dividends, not declared per-share amounts.
 */
export function aggregateTtmDividends(db: Database, asOfDate?: string): TtmDividendRow[] {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const oneYearAgo = (() => {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const rows = db
    .query<
      {
        ticker: string;
        ttmAmountCents: number;
        paymentCount: number;
        lastExDate: string | null;
      },
      [string, string]
    >(
      `SELECT ticker,
              SUM(amount_cents) AS ttmAmountCents,
              COUNT(*) AS paymentCount,
              MAX(txn_date) AS lastExDate
       FROM transactions
       WHERE txn_type = 'dividend' AND txn_date BETWEEN ? AND ?
       GROUP BY ticker
       ORDER BY ttmAmountCents DESC`,
    )
    .all(oneYearAgo, today);

  return rows;
}
