import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { config } from '../lib/config.ts';

let _db: Database | null = null;

/**
 * Returns the singleton Database instance. The DB file and its parent
 * directory are created if they don't exist. Foreign keys + WAL mode are
 * enabled on open.
 */
export function getDb(): Database {
  if (_db) return _db;

  const path = resolve(config.dbPath);
  mkdirSync(dirname(path), { recursive: true });

  _db = new Database(path, { create: true });
  _db.exec('PRAGMA foreign_keys = ON;');
  _db.exec('PRAGMA journal_mode = WAL;');
  return _db;
}

/** Close the singleton DB (mainly for tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Open a fresh, isolated in-memory database for tests. Does NOT touch the
 * singleton. Caller is responsible for closing it.
 */
export function openInMemoryDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}
