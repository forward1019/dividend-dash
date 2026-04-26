/**
 * Tests for the v0.4 yahoo-extras ingest module.
 *
 * We don't hit yfinance over the network here — the public fetchers are
 * thin wrappers we'll rely on integration smoke checks for. These tests
 * lock down the SQLite upsert contracts:
 *
 *   - upsertQuoteSnapshot is idempotent on (ticker, fetch_date)
 *   - upsertEtfHoldings replaces stale rows for the same fetch_date
 *   - upsertNews dedupes by (ticker, link) and prunes >90d old entries
 */

import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  type EtfHoldingsResult,
  type NewsItem,
  type QuoteSnapshot,
  upsertEtfHoldings,
  upsertNews,
  upsertQuoteSnapshot,
} from '../src/ingest/yahoo-extras.ts';

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

function makeSnapshot(overrides: Partial<QuoteSnapshot> = {}): QuoteSnapshot {
  return {
    ticker: 'JNJ',
    fetchDate: '2026-04-25',
    shortName: 'Johnson & Johnson',
    longName: 'Johnson & Johnson Inc.',
    exchange: 'NYSE',
    currency: 'USD',
    quoteType: 'EQUITY',
    sector: 'Healthcare',
    industry: 'Drug Manufacturers - General',
    summary: 'Johnson & Johnson manufactures pharmaceuticals.',
    website: 'https://www.jnj.com',
    price: 227.5,
    marketCap: 547_641_851_904,
    volume: 5_800_000,
    avgVolume3m: 8_400_000,
    beta: 0.33,
    fiftyTwoWeekHigh: 251.71,
    fiftyTwoWeekLow: 146.12,
    fiftyTwoWeekChangePct: 0.42,
    epsTrailing: 8.62,
    epsForward: 12.7,
    peTrailing: 26.39,
    peForward: 17.9,
    psRatio: 4.5,
    pbRatio: 6.72,
    pegRatio: 2.96,
    enterpriseValue: 580_000_000_000,
    evToRevenue: 4.6,
    evToEbitda: 18.5,
    freeCashFlow: 12_511_375_360,
    operatingCashFlow: 18_000_000_000,
    totalDebt: 54_990_000_000,
    totalCash: 22_050_000_000,
    returnOnEquity: 0.26416,
    returnOnAssets: 0.085,
    profitMargins: 0.218,
    dividendRate: 5.36,
    dividendYield: 0.0236,
    payoutRatio: 0.6,
    exDividendDate: '2026-05-26',
    expenseRatio: null,
    totalAssets: null,
    fundFamily: null,
    inceptionDate: null,
    ytdReturn: null,
    threeYearReturn: null,
    fiveYearReturn: null,
    rawJson: '{}',
    ...overrides,
  };
}

describe('upsertQuoteSnapshot', () => {
  test('inserts a new snapshot and reads back round-trip', () => {
    upsertQuoteSnapshot(db, makeSnapshot());
    const row = db
      .query<
        { pe_trailing: number | null; market_cap: number | null; sector: string | null },
        [string]
      >('SELECT pe_trailing, market_cap, sector FROM quote_snapshot WHERE ticker = ?')
      .get('JNJ');
    expect(row?.pe_trailing).toBeCloseTo(26.39, 2);
    expect(row?.market_cap).toBe(547_641_851_904);
    expect(row?.sector).toBe('Healthcare');
  });

  test('upsert is idempotent on same (ticker, fetch_date) and overwrites changing fields', () => {
    upsertQuoteSnapshot(db, makeSnapshot({ price: 220 }));
    upsertQuoteSnapshot(db, makeSnapshot({ price: 230 }));

    const rows = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM quote_snapshot')
      .get();
    expect(rows?.count).toBe(1);
    const row = db
      .query<{ price: number | null }, [string]>(
        'SELECT price FROM quote_snapshot WHERE ticker = ?',
      )
      .get('JNJ');
    expect(row?.price).toBe(230);
  });

  test('different fetch_date inserts a new historical row', () => {
    upsertQuoteSnapshot(db, makeSnapshot({ fetchDate: '2026-04-25' }));
    upsertQuoteSnapshot(db, makeSnapshot({ fetchDate: '2026-04-26', price: 230 }));
    const rows = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM quote_snapshot')
      .get();
    expect(rows?.count).toBe(2);
  });

  test('also upserts the underlying security row', () => {
    upsertQuoteSnapshot(db, makeSnapshot());
    const sec = db
      .query<{ name: string; sector: string | null }, [string]>(
        'SELECT name, sector FROM securities WHERE ticker = ?',
      )
      .get('JNJ');
    expect(sec?.name).toBe('Johnson & Johnson Inc.');
    expect(sec?.sector).toBe('Healthcare');
  });
});

describe('upsertEtfHoldings', () => {
  function makeHoldings(positions: number, fetchDate = '2026-04-25'): EtfHoldingsResult {
    return {
      holdings: Array.from({ length: positions }, (_, i) => ({
        position: i + 1,
        symbol: `H${i + 1}`,
        name: `Holding ${i + 1}`,
        allocationPct: 0.05 - i * 0.001,
      })),
      breakdown: {
        ticker: 'SCHD',
        fetchDate,
        totalHoldings: 100,
        sectorWeights: [
          { sector: 'Technology', pct: 0.15 },
          { sector: 'Healthcare', pct: 0.18 },
        ],
        assetClasses: null,
        bondRatings: null,
        bondHoldings: null,
        rawJson: '{}',
      },
    };
  }

  test('inserts top-N holdings with positions', () => {
    upsertEtfHoldings(db, 'SCHD', makeHoldings(10));
    const rows = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM etf_holdings')
      .get();
    expect(rows?.count).toBe(10);

    const top = db
      .query<{ holding_name: string; allocation_pct: number }, []>(
        'SELECT holding_name, allocation_pct FROM etf_holdings WHERE position = 1',
      )
      .get();
    expect(top?.holding_name).toBe('Holding 1');
  });

  test('replaces stale rows on same fetch_date when re-fetched with fewer holdings', () => {
    upsertEtfHoldings(db, 'SCHD', makeHoldings(10));
    upsertEtfHoldings(db, 'SCHD', makeHoldings(5));
    const rows = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM etf_holdings')
      .get();
    expect(rows?.count).toBe(5);
  });

  test('persists sector weights as JSON', () => {
    upsertEtfHoldings(db, 'SCHD', makeHoldings(3));
    const row = db
      .query<{ sector_weights_json: string | null }, [string]>(
        'SELECT sector_weights_json FROM etf_profile WHERE etf_ticker = ?',
      )
      .get('SCHD');
    expect(row?.sector_weights_json).toContain('Technology');
    expect(row?.sector_weights_json).toContain('Healthcare');
  });
});

describe('upsertNews', () => {
  function makeItem(overrides: Partial<NewsItem> = {}): NewsItem {
    return {
      ticker: 'JNJ',
      link: 'https://example.com/jnj-1',
      title: 'JNJ Beats Earnings',
      publisher: 'Reuters',
      publishedAt: new Date().toISOString(),
      summary: 'JNJ posted strong earnings.',
      thumbnailUrl: null,
      relatedTickers: 'JNJ,PFE',
      ...overrides,
    };
  }

  test('inserts new items and dedupes by link', () => {
    upsertNews(db, 'JNJ', [makeItem(), makeItem({ title: 'Updated Title' })]);
    const row = db
      .query<{ count: number; title: string }, []>(
        'SELECT COUNT(*) AS count, MAX(title) AS title FROM ticker_news',
      )
      .get();
    // Same link → single row, latest title wins via ON CONFLICT.
    expect(row?.count).toBe(1);
    expect(row?.title).toBe('Updated Title');
  });

  test('keeps multiple items for the same ticker with different links', () => {
    upsertNews(db, 'JNJ', [
      makeItem({ link: 'https://example.com/a' }),
      makeItem({ link: 'https://example.com/b' }),
      makeItem({ link: 'https://example.com/c' }),
    ]);
    const row = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM ticker_news').get();
    expect(row?.count).toBe(3);
  });

  test('prunes entries older than 90 days when new items are inserted', () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    upsertNews(db, 'JNJ', [makeItem({ link: 'https://example.com/old', publishedAt: old })]);
    expect(
      db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM ticker_news').get()?.count,
    ).toBe(1);

    // Inserting a fresh item should evict the >90d old one.
    upsertNews(db, 'JNJ', [makeItem({ link: 'https://example.com/new' })]);
    const remaining = db
      .query<{ link: string }, []>('SELECT link FROM ticker_news')
      .all()
      .map((r) => r.link);
    expect(remaining).toEqual(['https://example.com/new']);
  });

  test('no-op on empty input list', () => {
    upsertNews(db, 'JNJ', []);
    const count = db
      .query<{ count: number }, []>('SELECT COUNT(*) AS count FROM ticker_news')
      .get()?.count;
    expect(count).toBe(0);
  });
});
