import { describe, expect, test } from 'bun:test';

import { parseCsvRow, parseManualCsv } from '../src/ingest/csv/manual.ts';

describe('parseCsvRow', () => {
  test('simple comma-separated', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  test('handles quoted fields with commas', () => {
    expect(parseCsvRow('"hello, world",foo,"x,y,z"')).toEqual(['hello, world', 'foo', 'x,y,z']);
  });

  test('handles escaped quotes inside quoted field', () => {
    expect(parseCsvRow('"He said ""hi""",bar')).toEqual(['He said "hi"', 'bar']);
  });

  test('preserves empty fields', () => {
    expect(parseCsvRow('a,,c')).toEqual(['a', '', 'c']);
    expect(parseCsvRow(',,')).toEqual(['', '', '']);
  });
});

describe('parseManualCsv', () => {
  test('parses minimal valid CSV', () => {
    const csv = `ticker,shares,cost_basis,as_of_date
SCHD,100,7500.00,2026-04-25
VYM,50,5000.00,2026-04-25`;
    const r = parseManualCsv(csv, { defaultBroker: 'manual' });
    expect(r.errors).toEqual([]);
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings[0]).toMatchObject({
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
      broker: 'manual',
    });
  });

  test('uppercases tickers', () => {
    const csv = `ticker,shares,cost_basis,as_of_date
schd,100,7500.00,2026-04-25`;
    const r = parseManualCsv(csv, { defaultBroker: 'manual' });
    expect(r.holdings[0]?.ticker).toBe('SCHD');
  });

  test('handles cost_basis with $ and commas', () => {
    const csv = `ticker,shares,cost_basis,as_of_date
SCHD,100,"$7,500.00",2026-04-25`;
    const r = parseManualCsv(csv, { defaultBroker: 'manual' });
    expect(r.holdings[0]?.costBasisCents).toBe(750000);
  });

  test('uses default broker and as-of-date', () => {
    const csv = `ticker,shares,cost_basis
SCHD,100,7500.00`;
    const r = parseManualCsv(csv, { defaultBroker: '401k', defaultAsOfDate: '2026-01-01' });
    expect(r.holdings[0]?.broker).toBe('401k');
    expect(r.holdings[0]?.asOfDate).toBe('2026-01-01');
  });

  test('rejects unknown broker', () => {
    const csv = `ticker,shares,cost_basis,broker
SCHD,100,7500.00,etrade`;
    const r = parseManualCsv(csv);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.error).toContain('invalid broker');
  });

  test('reports row-level errors but continues', () => {
    const csv = `ticker,shares,cost_basis,as_of_date
SCHD,100,7500.00,2026-04-25
,50,5000.00,2026-04-25
VYM,bad,5000.00,2026-04-25
VTI,50,5000.00,2026-04-25`;
    const r = parseManualCsv(csv, { defaultBroker: 'manual' });
    expect(r.holdings).toHaveLength(2);
    expect(r.holdings.map((h) => h.ticker)).toEqual(['SCHD', 'VTI']);
    expect(r.errors).toHaveLength(2);
  });

  test('handles empty CSV', () => {
    expect(parseManualCsv('').holdings).toEqual([]);
    expect(parseManualCsv('ticker,shares,cost_basis').holdings).toEqual([]);
  });

  test('cost_basis_cents takes precedence over cost_basis', () => {
    const csv = `ticker,shares,cost_basis_cents,as_of_date
SCHD,100,750050,2026-04-25`;
    const r = parseManualCsv(csv, { defaultBroker: 'manual' });
    expect(r.holdings[0]?.costBasisCents).toBe(750050);
  });
});
