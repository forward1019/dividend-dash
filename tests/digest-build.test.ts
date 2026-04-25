import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { insertDividendEvent, insertTransaction, upsertHolding } from '../src/db/repo.ts';
import { buildDigest } from '../src/digest/build.ts';

const SCHEMA = readFileSync(resolve(import.meta.dir, '../src/db/schema.sql'), 'utf-8');

let db: Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
});
afterEach(() => db.close());

describe('buildDigest', () => {
  test('empty DB produces empty-state digest', () => {
    const md = buildDigest(db, { asOfDate: '2026-04-25' });
    expect(md).toContain('No holdings ingested yet');
  });

  test('produces a multi-section digest with holdings + dividends', () => {
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
      ticker: 'VYM',
      shares: 75,
      costBasisCents: 600000,
      asOfDate: '2026-04-25',
    });
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2025-09-15',
      amountCents: 5500,
      feesCents: 0,
    });
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2025-12-15',
      amountCents: 6000,
      feesCents: 0,
    });
    insertDividendEvent(db, {
      ticker: 'SCHD',
      exDate: '2025-12-15',
      amountPerShareMicros: 600_000,
      source: 'yfinance',
    });

    const md = buildDigest(db, { asOfDate: '2026-04-25' });

    expect(md).toContain('dividend-dash weekly digest');
    expect(md).toContain('SCHD');
    expect(md).toContain('VYM');
    expect(md).toContain('Top dividend earners');
    expect(md).toContain('Sustainability scorecard');
    // Total cost basis = $7500 + $6000 = $13,500
    expect(md).toContain('$13500.00');
  });

  test('omits MC section when includeMonteCarlo=false', () => {
    upsertHolding(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
    });
    insertTransaction(db, {
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'dividend',
      txnDate: '2025-12-15',
      amountCents: 6000,
      feesCents: 0,
    });

    const mdWith = buildDigest(db, { asOfDate: '2026-04-25', includeMonteCarlo: true });
    const mdWithout = buildDigest(db, { asOfDate: '2026-04-25', includeMonteCarlo: false });
    expect(mdWith).toContain('Forward dividend income');
    expect(mdWithout).not.toContain('Forward dividend income');
  });
});
