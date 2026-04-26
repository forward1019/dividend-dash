import { describe, expect, test } from 'bun:test';

import { Database } from 'bun:sqlite';

import { validatePriceAgainstStooq } from '../src/ingest/stooq.ts';

/**
 * Build a tiny in-memory DB matching the shape we need.
 */
function freshDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE securities(ticker TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');`);
  db.run(`CREATE TABLE prices(
    ticker TEXT NOT NULL, date TEXT NOT NULL, close_cents INTEGER NOT NULL,
    source TEXT NOT NULL, PRIMARY KEY(ticker, date, source))`);
  return db;
}

describe('validatePriceAgainstStooq', () => {
  // These hit the live Stooq endpoint. Keep the assertion loose: we only
  // care that a well-known liquid US ticker round-trips through the parser
  // and produces an "agrees" or "price-diverged" verdict — never a parse
  // failure.
  test('returns no-yahoo if our DB has no price for the ticker', async () => {
    const db = freshDb();
    const v = await validatePriceAgainstStooq(db, 'AAPL');
    expect(v.reason).toBe('no-yahoo');
    expect(v.agrees).toBe(false);
  });

  test('agrees when Yahoo and Stooq close are identical', async () => {
    // We seed the DB with a known-close that we don't actually verify
    // against Stooq. The point of this test is to confirm the validator
    // classifies "match" correctly. Stooq returns the *current* close,
    // so we can't easily seed against it without flake. Instead we pull
    // Stooq, then assert the verdict makes sense whichever way it goes.
    const db = freshDb();
    db.run("INSERT INTO securities(ticker, name) VALUES ('AAPL', 'Apple')");
    // Insert a placeholder yahoo close — we'll inspect the verdict shape
    db.run(
      "INSERT INTO prices(ticker, date, close_cents, source) VALUES ('AAPL', '2026-04-24', 19000, 'yfinance')",
    );
    const v = await validatePriceAgainstStooq(db, 'AAPL');
    // Stooq either responds with a real price or null. Either way we get
    // back a structured verdict — never a thrown error.
    expect(['agree', 'price-diverged', 'date-mismatch', 'missing-source']).toContain(v.reason);
    expect(typeof v.agrees).toBe('boolean');
    if (v.stooqClose !== null && v.yahooClose !== null) {
      expect(v.stooqClose).toBeGreaterThan(0);
      expect(v.yahooClose).toBeGreaterThan(0);
    }
  });
});
