/**
 * Repository layer — typed upsert helpers for the core tables.
 * All callers should go through this module; do not write raw INSERTs scattered
 * across the codebase.
 */

import type { Database } from 'bun:sqlite';

import type { DividendEvent, Holding, Transaction } from '../types.ts';

export interface SecurityUpsert {
  ticker: string;
  name: string;
  cusip?: string | null;
  cik?: string | null;
  sector?: string | null;
  industry?: string | null;
  exchange?: string | null;
  currency?: string;
}

export function upsertSecurity(db: Database, sec: SecurityUpsert): void {
  db.run(
    `INSERT INTO securities(ticker, name, cusip, cik, sector, industry, exchange, currency, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(ticker) DO UPDATE SET
       name = excluded.name,
       cusip = COALESCE(excluded.cusip, securities.cusip),
       cik = COALESCE(excluded.cik, securities.cik),
       sector = COALESCE(excluded.sector, securities.sector),
       industry = COALESCE(excluded.industry, securities.industry),
       exchange = COALESCE(excluded.exchange, securities.exchange),
       currency = excluded.currency,
       updated_at = datetime('now')`,
    [
      sec.ticker.toUpperCase(),
      sec.name,
      sec.cusip ?? null,
      sec.cik ?? null,
      sec.sector ?? null,
      sec.industry ?? null,
      sec.exchange ?? null,
      sec.currency ?? 'USD',
    ],
  );
}

/**
 * Upsert a holding snapshot. Snapshots are uniquely identified by
 * (broker, account, ticker, as_of_date).
 */
export function upsertHolding(db: Database, h: Holding): void {
  // Securities row must exist first (FK).
  upsertSecurity(db, { ticker: h.ticker, name: h.ticker });

  db.run(
    `INSERT INTO holdings(broker, account, ticker, shares, cost_basis_cents, as_of_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(broker, account, ticker, as_of_date) DO UPDATE SET
       shares = excluded.shares,
       cost_basis_cents = excluded.cost_basis_cents,
       updated_at = datetime('now')`,
    [h.broker, h.account, h.ticker, h.shares, h.costBasisCents, h.asOfDate],
  );
}

/**
 * Insert a transaction. Returns true if the row was newly inserted, false if
 * a duplicate row already existed (idempotent re-imports).
 */
export function insertTransaction(db: Database, t: Transaction): boolean {
  upsertSecurity(db, { ticker: t.ticker, name: t.ticker });

  const result = db.run(
    `INSERT OR IGNORE INTO transactions(
       broker, account, ticker, txn_type, txn_date, shares, price_cents,
       amount_cents, fees_cents, notes, source_file
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      t.broker,
      t.account,
      t.ticker,
      t.txnType,
      t.txnDate,
      t.shares ?? null,
      t.priceCents ?? null,
      t.amountCents,
      t.feesCents,
      t.notes ?? null,
      t.sourceFile ?? null,
    ],
  );
  return result.changes > 0;
}

/**
 * Insert a dividend event. Returns true if newly inserted.
 */
export function insertDividendEvent(db: Database, e: DividendEvent): boolean {
  upsertSecurity(db, { ticker: e.ticker, name: e.ticker });

  const cents = Math.round(e.amountPerShareMicros / 10_000);
  const result = db.run(
    `INSERT OR IGNORE INTO dividend_events(
       ticker, ex_date, pay_date, record_date, declared_date,
       amount_per_share_cents, amount_per_share_micros, frequency, source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.ticker,
      e.exDate,
      e.payDate ?? null,
      e.recordDate ?? null,
      e.declaredDate ?? null,
      cents,
      e.amountPerShareMicros,
      e.frequency ?? null,
      e.source,
    ],
  );
  return result.changes > 0;
}

export interface IngestLogEntry {
  broker: string;
  sourceFile: string;
  sourceSha256: string;
  rowsTotal: number;
  rowsInserted: number;
  rowsSkipped: number;
  rowsErrored: number;
  errors?: unknown;
}

export function recordIngest(db: Database, entry: IngestLogEntry): void {
  db.run(
    `INSERT OR IGNORE INTO ingest_log(
       broker, source_file, source_sha256, rows_total, rows_inserted,
       rows_skipped, rows_errored, errors_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.broker,
      entry.sourceFile,
      entry.sourceSha256,
      entry.rowsTotal,
      entry.rowsInserted,
      entry.rowsSkipped,
      entry.rowsErrored,
      entry.errors ? JSON.stringify(entry.errors) : null,
    ],
  );
}
