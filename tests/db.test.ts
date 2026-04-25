import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let db: Database;

const SCHEMA = readFileSync(resolve(import.meta.dir, '../src/db/schema.sql'), 'utf-8');

beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
});

afterEach(() => {
  db.close();
});

describe('schema', () => {
  test('all expected tables exist', () => {
    const rows = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    const names = rows.map((r) => r.name);

    expect(names).toContain('holdings');
    expect(names).toContain('transactions');
    expect(names).toContain('dividend_events');
    expect(names).toContain('securities');
    expect(names).toContain('prices');
    expect(names).toContain('fundamentals');
    expect(names).toContain('ingest_log');
    expect(names).toContain('schema_version');
  });

  test('schema_version row inserted', () => {
    const row = db
      .query<{ version: number }, []>('SELECT MAX(version) AS version FROM schema_version')
      .get();
    expect(row?.version).toBeGreaterThanOrEqual(1);
  });

  test('holdings unique constraint prevents dup insert', () => {
    // First, need a security row for the FK
    db.run("INSERT INTO securities(ticker, name) VALUES ('SCHD', 'Schwab US Dividend Equity ETF')");

    db.run(
      `INSERT INTO holdings(broker, account, ticker, shares, cost_basis_cents, as_of_date)
       VALUES ('fidelity', '...1234', 'SCHD', 100.0, 750000, '2026-04-25')`,
    );

    expect(() =>
      db.run(
        `INSERT INTO holdings(broker, account, ticker, shares, cost_basis_cents, as_of_date)
         VALUES ('fidelity', '...1234', 'SCHD', 100.0, 750000, '2026-04-25')`,
      ),
    ).toThrow();
  });

  test('transactions FK to securities is enforced', () => {
    expect(() =>
      db.run(
        `INSERT INTO transactions(broker, account, ticker, txn_type, txn_date, amount_cents)
         VALUES ('fidelity', '...1234', 'NOPE', 'buy', '2026-04-25', -10000)`,
      ),
    ).toThrow();
  });
});
