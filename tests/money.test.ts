import { describe, expect, test } from 'bun:test';

import {
  centsToDollars,
  dollarsToCents,
  dollarsToMicros,
  formatUsd,
  microsToCents,
  microsToDollars,
} from '../src/lib/money.ts';

describe('money conversions', () => {
  test('dollars to cents round-trips', () => {
    expect(dollarsToCents(1.23)).toBe(123);
    expect(centsToDollars(123)).toBe(1.23);
  });

  test('dollars to micros round-trips', () => {
    expect(dollarsToMicros(0.4225)).toBe(422_500);
    expect(microsToDollars(422_500)).toBe(0.4225);
  });

  test('handles known floating-point traps', () => {
    // 0.1 + 0.2 floats to 0.30000000000000004; conversion must round, not truncate
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(123.45)).toBe(12345);
  });

  test('rejects non-finite numbers', () => {
    expect(() => dollarsToCents(Number.NaN)).toThrow();
    expect(() => dollarsToCents(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => dollarsToMicros(Number.NaN)).toThrow();
  });

  test('micros to cents truncates correctly', () => {
    // $0.4225 → 422_500 micros → 42 cents (rounds 42.25)
    expect(microsToCents(422_500)).toBe(42);
    expect(microsToCents(425_000)).toBe(43); // exactly 0.425 → 42.5 cents → rounds to 43
  });

  test('formatUsd formats as expected', () => {
    expect(formatUsd(12345)).toBe('$123.45');
    expect(formatUsd(-12345)).toBe('$-123.45');
    expect(formatUsd(12345, { sign: true })).toBe('+$123.45');
    expect(formatUsd(0)).toBe('$0.00');
  });
});
