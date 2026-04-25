import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aggregatePortfolio, aggregateTtmDividends } from '../src/analytics/portfolio.ts';
import { insertTransaction, upsertHolding } from '../src/db/repo.ts';

const SCHEMA = readFileSync(resolve(import.meta.dir, '../src/db/schema.sql'), 'utf-8');

let db: Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
});

afterEach(() => {
  db.close();
});

describe('aggregatePortfolio', () => {
  test('rolls up holdings across brokers', () => {
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
    });
    upsertHolding(db, {
      broker: 'robinhood',
      account: '...9999',
      ticker: 'SCHD',
      shares: 50,
      costBasisCents: 375000,
      asOfDate: '2026-04-25',
    });
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'VYM',
      shares: 75,
      costBasisCents: 600000,
      asOfDate: '2026-04-25',
    });

    const portfolio = aggregatePortfolio(db);
    expect(portfolio).toHaveLength(2);

    const schd = portfolio.find((p) => p.ticker === 'SCHD')!;
    expect(schd.totalShares).toBe(150);
    expect(schd.totalCostBasisCents).toBe(1125000);
    expect(schd.brokerCount).toBe(2);
    expect(schd.brokers.sort()).toEqual(['fidelity', 'robinhood']);

    const vym = portfolio.find((p) => p.ticker === 'VYM')!;
    expect(vym.totalShares).toBe(75);
    expect(vym.brokerCount).toBe(1);
  });

  test('uses most recent snapshot per (broker,account,ticker)', () => {
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 700000,
      asOfDate: '2026-01-01',
    });
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 120,
      costBasisCents: 900000,
      asOfDate: '2026-04-25',
    });

    const portfolio = aggregatePortfolio(db);
    expect(portfolio).toHaveLength(1);
    expect(portfolio[0]?.totalShares).toBe(120);
    expect(portfolio[0]?.totalCostBasisCents).toBe(900000);
  });

  test('returns empty array when no holdings', () => {
    expect(aggregatePortfolio(db)).toEqual([]);
  });
});

describe('aggregateTtmDividends', () => {
  test('sums dividend transactions in trailing 12 months', () => {
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2025-09-01',
      amountCents: 5000,
      feesCents: 0,
    });
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2025-12-15',
      amountCents: 5500,
      feesCents: 0,
    });
    // Outside TTM window
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2024-01-01',
      amountCents: 4000,
      feesCents: 0,
    });

    const ttm = aggregateTtmDividends(db, '2026-04-25');
    expect(ttm).toHaveLength(1);
    expect(ttm[0]?.ticker).toBe('SCHD');
    expect(ttm[0]?.ttmAmountCents).toBe(10500);
    expect(ttm[0]?.paymentCount).toBe(2);
  });

  test('ignores non-dividend transactions', () => {
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'buy',
      txnDate: '2026-04-01',
      amountCents: -750000,
      feesCents: 0,
      shares: 100,
      priceCents: 7500,
    });

    const ttm = aggregateTtmDividends(db, '2026-04-25');
    expect(ttm).toEqual([]);
  });
});
