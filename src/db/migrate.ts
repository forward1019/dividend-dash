#!/usr/bin/env bun
/**
 * Apply schema.sql to the database. Idempotent — uses CREATE TABLE IF NOT EXISTS.
 *
 * Usage:
 *   bun run migrate
 *   bun run src/db/migrate.ts --db=./data/test.db
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getDb } from './db.ts';

function main(): void {
  const schemaPath = resolve(import.meta.dir, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf-8');

  const db = getDb();
  db.exec(sql);

  const versionRow = db
    .query<{ version: number }, []>('SELECT MAX(version) AS version FROM schema_version')
    .get();

  console.log(`✓ Schema applied. Version: ${versionRow?.version ?? 'unknown'}`);
}

if (import.meta.main) {
  main();
}
