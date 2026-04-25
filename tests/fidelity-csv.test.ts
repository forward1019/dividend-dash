import { describe, expect, test } from 'bun:test';

import { parseFidelityCsv } from '../src/ingest/csv/fidelity.ts';

const FIXTURE = `"Account Number","Account Name","Symbol","Description","Quantity","Last Price","Last Price Change","Current Value","Today's Gain/Loss Dollar","Today's Gain/Loss Percent","Total Gain/Loss Dollar","Total Gain/Loss Percent","Cost Basis Total","Average Cost Basis","Type"
"X12345678","INDIVIDUAL","SCHD","SCHWAB U S DIVIDEND EQUITY ETF","100.0000","$76.50","+$0.45","$7,650.00","+$45.00","+0.59%","+$150.00","+2.00%","$7,500.00","$75.00","Cash"
"X12345678","INDIVIDUAL","VTI","VANGUARD TOTAL STOCK MARKET ETF","25.5000","$240.00","+$1.20","$6,120.00","+$30.60","+0.50%","+$120.00","+2.00%","$6,000.00","$235.29","Cash"
"X12345678","INDIVIDUAL","Pending Activity","--","--","--","--","--","--","--","--","--","--","--","Cash"
"","","","","","","","","","","","","","",""
"Date downloaded 04/25/2026 12:00 PM ET"
"Brokerage services provided by Fidelity Brokerage Services LLC..."`;

describe('parseFidelityCsv', () => {
  test('parses Fidelity positions export', () => {
    const r = parseFidelityCsv(FIXTURE, { asOfDate: '2026-04-25' });
    expect(r.errors).toEqual([]);
    expect(r.holdings).toHaveLength(2);

    expect(r.holdings[0]).toMatchObject({
      broker: 'fidelity',
      account: '...5678',
      ticker: 'SCHD',
      shares: 100,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
    });

    expect(r.holdings[1]).toMatchObject({
      ticker: 'VTI',
      shares: 25.5,
      costBasisCents: 600000,
    });
  });

  test('skips Pending Activity rows', () => {
    const r = parseFidelityCsv(FIXTURE);
    expect(r.holdings.find((h) => h.ticker.toLowerCase().includes('pending'))).toBeUndefined();
  });

  test('stops at the footer disclaimer', () => {
    const r = parseFidelityCsv(FIXTURE);
    // The disclaimer line should be excluded; the parsed holding count is 2.
    expect(r.holdings).toHaveLength(2);
  });

  test('returns error if header is missing', () => {
    const r = parseFidelityCsv('hello world\nrandom data');
    expect(r.holdings).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.error).toContain('Could not find a Fidelity header');
  });

  test('masks account numbers to last 4 digits', () => {
    const r = parseFidelityCsv(FIXTURE);
    expect(r.holdings[0]?.account).toBe('...5678');
  });
});
