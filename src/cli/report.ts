#!/usr/bin/env bun
/**
 * `bun run report` — print a plain-text portfolio summary to stdout.
 *
 * Phase 0 stub. Phase 1 wires up portfolio aggregation; Phase 2 adds analytics.
 */

import { getDb } from '../db/db.ts';
import { log } from '../lib/logger.ts';

async function main(): Promise<void> {
  const db = getDb();

  const counts = db
    .query<{ table_name: string; count: number }, []>(
      `SELECT 'holdings' AS table_name, COUNT(*) AS count FROM holdings
       UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
       UNION ALL SELECT 'dividend_events', COUNT(*) FROM dividend_events
       UNION ALL SELECT 'securities', COUNT(*) FROM securities`,
    )
    .all();

  console.log('=== dividend-dash report ===');
  for (const row of counts) {
    console.log(`  ${row.table_name.padEnd(20)} ${row.count}`);
  }

  if (counts.every((r) => r.count === 0)) {
    console.log('\nNo data ingested yet. Run `bun run ingest -- --broker=<name> --file=<path>`.');
  }

  log.info('report complete');
}

if (import.meta.main) {
  await main();
}
