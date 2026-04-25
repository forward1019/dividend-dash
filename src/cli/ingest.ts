#!/usr/bin/env bun
/**
 * `bun run ingest -- --broker=<name> --file=<path> [--as-of=YYYY-MM-DD]`
 *
 * Dispatches to the per-broker parser, upserts holdings into the DB, and
 * records the import in ingest_log.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getDb } from '../db/db.ts';
import { recordIngest, upsertHolding } from '../db/repo.ts';
import { parseFidelityCsv } from '../ingest/csv/fidelity.ts';
import { parseManualCsv } from '../ingest/csv/manual.ts';
import { log } from '../lib/logger.ts';
import { type Broker, BrokerSchema, type Holding } from '../types.ts';

interface Args {
  broker?: string;
  file?: string;
  asOf?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const a of argv) {
    if (a.startsWith('--broker=')) args.broker = a.slice('--broker='.length);
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
    else if (a.startsWith('--as-of=')) args.asOf = a.slice('--as-of='.length);
  }
  return args;
}

function sha256(buf: Uint8Array): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(buf);
  return hasher.digest('hex');
}

function parseFile(broker: Broker, csv: string, asOf: string | undefined) {
  if (broker === 'fidelity') {
    const r = parseFidelityCsv(csv, { asOfDate: asOf });
    return { holdings: r.holdings, errors: r.errors.map((e) => ({ row: e.row, error: e.error })) };
  }
  if (broker === 'manual' || broker === '401k' || broker === 'robinhood' || broker === 'ibkr') {
    // robinhood and ibkr exports are passed through the manual parser until
    // dedicated parsers ship — manual parser will fail loudly on unknown
    // schemas so we don't silently accept garbage.
    const r = parseManualCsv(csv, { defaultBroker: broker, defaultAsOfDate: asOf });
    return { holdings: r.holdings, errors: r.errors.map((e) => ({ row: e.row, error: e.error })) };
  }
  throw new Error(`No parser for broker: ${broker}`);
}

async function main(): Promise<void> {
  const { broker, file, asOf } = parseArgs(Bun.argv.slice(2));

  if (!broker || !file) {
    console.error(
      'Usage: bun run ingest -- --broker=<fidelity|robinhood|ibkr|manual|401k> --file=<path> [--as-of=YYYY-MM-DD]',
    );
    process.exit(1);
  }

  const brokerParsed = BrokerSchema.safeParse(broker);
  if (!brokerParsed.success) {
    console.error(`Unknown broker: ${broker}. Allowed: ${BrokerSchema.options.join(', ')}`);
    process.exit(1);
  }

  const filePath = resolve(file);
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const buf = readFileSync(filePath);
  const csv = buf.toString('utf-8');
  const fileSha = sha256(buf);

  log.info('parsing file', { broker: brokerParsed.data, file: filePath });
  const { holdings, errors } = parseFile(brokerParsed.data, csv, asOf);

  log.info(`parsed ${holdings.length} holdings, ${errors.length} errors`);

  const db = getDb();
  let inserted = 0;
  db.transaction(() => {
    for (const h of holdings) {
      const target: Holding = { ...h };
      upsertHolding(db, target);
      inserted++;
    }
    recordIngest(db, {
      broker: brokerParsed.data,
      sourceFile: filePath,
      sourceSha256: fileSha,
      rowsTotal: holdings.length + errors.length,
      rowsInserted: inserted,
      rowsSkipped: 0,
      rowsErrored: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  })();

  console.log(`✓ Ingested ${inserted} holdings from ${file}`);
  if (errors.length > 0) {
    console.log(`  ⚠ ${errors.length} rows had errors:`);
    for (const e of errors.slice(0, 10)) {
      console.log(`    row ${e.row}: ${e.error}`);
    }
    if (errors.length > 10) console.log(`    ... and ${errors.length - 10} more`);
  }
}

if (import.meta.main) {
  await main();
}
