import { describe, expect, test } from 'bun:test';

import {
  BrokerSchema,
  DividendEventSchema,
  FrequencySchema,
  HoldingSchema,
  TransactionSchema,
  TxnTypeSchema,
} from '../src/types.ts';

describe('Zod schemas', () => {
  test('BrokerSchema accepts known brokers', () => {
    expect(BrokerSchema.parse('fidelity')).toBe('fidelity');
    expect(BrokerSchema.parse('robinhood')).toBe('robinhood');
    expect(() => BrokerSchema.parse('etrade')).toThrow();
  });

  test('TxnTypeSchema accepts known types', () => {
    expect(TxnTypeSchema.parse('buy')).toBe('buy');
    expect(TxnTypeSchema.parse('dividend')).toBe('dividend');
    expect(() => TxnTypeSchema.parse('rebalance')).toThrow();
  });

  test('FrequencySchema accepts known frequencies', () => {
    expect(FrequencySchema.parse('monthly')).toBe('monthly');
    expect(FrequencySchema.parse('quarterly')).toBe('quarterly');
  });

  test('HoldingSchema validates and uppercases ticker', () => {
    const h = HoldingSchema.parse({
      broker: 'fidelity',
      account: '...1234',
      ticker: 'schd',
      shares: 100.5,
      costBasisCents: 750000,
      asOfDate: '2026-04-25',
    });
    expect(h.ticker).toBe('SCHD');
    expect(h.shares).toBe(100.5);
  });

  test('HoldingSchema rejects malformed date', () => {
    expect(() =>
      HoldingSchema.parse({
        broker: 'fidelity',
        account: '...1234',
        ticker: 'SCHD',
        shares: 100,
        costBasisCents: 0,
        asOfDate: '04/25/2026',
      }),
    ).toThrow();
  });

  test('TransactionSchema defaults feesCents to 0', () => {
    const t = TransactionSchema.parse({
      broker: 'fidelity',
      account: '...1234',
      ticker: 'SCHD',
      txnType: 'buy',
      txnDate: '2026-04-25',
      amountCents: -750000,
    });
    expect(t.feesCents).toBe(0);
  });

  test('DividendEventSchema requires non-negative micros', () => {
    expect(() =>
      DividendEventSchema.parse({
        ticker: 'SCHD',
        exDate: '2026-03-15',
        amountPerShareMicros: -100,
        source: 'yfinance',
      }),
    ).toThrow();
  });
});
