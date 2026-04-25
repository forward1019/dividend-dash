import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  insertDividendEvent,
  insertTransaction,
  recordIngest,
  upsertHolding,
  upsertSecurity,
} from '../src/db/repo.ts';

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

describe('repo upsert behavior', () => {
  test('upsertSecurity preserves CIK on subsequent calls without it', () => {
    upsertSecurity(db, { ticker: 'SCHD', name: 'Schwab', cik: '0000884394' });
    upsertSecurity(db, { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF' });

    const row = db
      .query<{ name: string; cik: string | null }, []>(
        "SELECT name, cik FROM securities WHERE ticker = 'SCHD'",
      )
      .get();
    expect(row?.name).toBe('Schwab US Dividend Equity ETF');
    expect(row?.cik).toBe('0000884394'); // preserved via COALESCE
  });

  test('upsertHolding updates shares on conflict', () => {
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
    });
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 150,
      costBasisCents: 1125000,
      asOfDate: '2026-04-25',
    });
    const row = db
      .query<{ shares: number; cost_basis_cents: number }, []>(
        "SELECT shares, cost_basis_cents FROM holdings WHERE ticker = 'SCHD'",
      )
      .get();
    expect(row?.shares).toBe(150);
    expect(row?.cost_basis_cents).toBe(1125000);
  });

  test('insertTransaction is idempotent on identical re-import', () => {
    const t = {
      broker: 'fidelity' as const,
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend' as const,
      txnDate: '2025-12-15',
      amountCents: 5500,
      feesCents: 0,
    };
    expect(insertTransaction(db, t)).toBe(true);
    expect(insertTransaction(db, t)).toBe(false);

    const count = db
      .query<{ c: number }, []>("SELECT COUNT(*) AS c FROM transactions WHERE ticker = 'SCHD'")
      .get();
    expect(count?.c).toBe(1);
  });

  test('insertDividendEvent dedupes by (ticker, ex_date, source)', () => {
    expect(
      insertDividendEvent(db, {
        ticker: 'SCHD',
        exDate: '2025-12-15',
        amountPerShareMicros: 250_000,
        source: 'yfinance',
      }),
    ).toBe(true);

    expect(
      insertDividendEvent(db, {
        ticker: 'SCHD',
        exDate: '2025-12-15',
        amountPerShareMicros: 250_000,
        source: 'yfinance',
      }),
    ).toBe(false);

    // Different source is allowed
    expect(
      insertDividendEvent(db, {
        ticker: 'SCHD',
        exDate: '2025-12-15',
        amountPerShareMicros: 250_000,
        source: 'sec_edgar',
      }),
    ).toBe(true);
  });

  test('recordIngest stores row-level errors as JSON', () => {
    recordIngest(db, {
      broker: 'fidelity',
      sourceFile: '/tmp/x.csv',
      sourceSha256: 'abc123',
      rowsTotal: 10,
      rowsInserted: 8,
      rowsSkipped: 0,
      rowsErrored: 2,
      errors: [{ row: 5, error: 'bad' }],
    });
    const row = db
      .query<{ errors_json: string }, []>(
        "SELECT errors_json FROM ingest_log WHERE source_file = '/tmp/x.csv'",
      )
      .get();
    expect(JSON.parse(row!.errors_json)).toEqual([{ row: 5, error: 'bad' }]);
  });
});
