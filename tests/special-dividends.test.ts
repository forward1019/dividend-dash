import { describe, expect, test } from 'bun:test';

import {
  type DividendEventInput,
  classifyDividends,
  forwardYield,
  ttmDividendPerShare,
  ttmRegularDividendPerShare,
} from '../src/analytics/dividend-stats.ts';

/**
 * MAIN-style stream: monthly $0.26 regular + quarterly $0.30 supplemental
 * over 2 years. We expect classifier to flag the supplementals as 'special'
 * and leave the monthly cadence as 'regular'.
 */
function mainStyleStream(): DividendEventInput[] {
  const out: DividendEventInput[] = [];
  for (let year = 2024; year <= 2025; year++) {
    for (let month = 1; month <= 12; month++) {
      // Monthly regular on the 8th
      const m = String(month).padStart(2, '0');
      out.push({
        exDate: `${year}-${m}-08`,
        amountPerShareMicros: 260_000, // $0.26
      });
      // Supplemental on the 22nd of March, June, Sept, Dec
      if (month % 3 === 0) {
        out.push({
          exDate: `${year}-${m}-22`,
          amountPerShareMicros: 300_000, // $0.30
        });
      }
    }
  }
  return out;
}

describe('classifyDividends', () => {
  test('flags MAIN supplementals as special, keeps monthly as regular', () => {
    const events = mainStyleStream();
    const classified = classifyDividends(events);
    const specials = classified.filter((c) => c.classification === 'special');
    const regulars = classified.filter((c) => c.classification === 'regular');
    // First few rounds we don't have enough history; expect ~6 specials over 2y
    // (8 supplementals total, but the first 1-2 fall through the warmup window)
    expect(specials.length).toBeGreaterThanOrEqual(5);
    expect(specials.length).toBeLessThanOrEqual(8);
    expect(regulars.length).toBeGreaterThanOrEqual(20);
    // Every special should be a $0.30 payment
    for (const s of specials) {
      expect(s.amountPerShareMicros).toBe(300_000);
    }
  });

  test('treats steady quarterly stream as all-regular (no false positives)', () => {
    const events: DividendEventInput[] = [];
    for (let y = 2020; y <= 2025; y++) {
      for (const m of ['03', '06', '09', '12']) {
        events.push({ exDate: `${y}-${m}-15`, amountPerShareMicros: 250_000 });
      }
    }
    const classified = classifyDividends(events);
    const specials = classified.filter((c) => c.classification === 'special');
    expect(specials.length).toBe(0);
  });

  test('flags one-off 3x special even on a stable stream', () => {
    const events: DividendEventInput[] = [];
    for (let y = 2020; y <= 2025; y++) {
      for (const m of ['03', '06', '09', '12']) {
        events.push({ exDate: `${y}-${m}-15`, amountPerShareMicros: 250_000 });
      }
    }
    // Inject a fat special between 2024 Q3 and Q4
    events.push({ exDate: '2024-10-30', amountPerShareMicros: 1_000_000 }); // $1.00 = 4×
    const classified = classifyDividends(events);
    const special = classified.find((c) => c.exDate === '2024-10-30');
    expect(special?.classification).toBe('special');
  });

  test('does not flag a normal 5% raise as special', () => {
    const events: DividendEventInput[] = [];
    let cur = 250_000;
    for (let y = 2020; y <= 2025; y++) {
      for (const m of ['03', '06', '09', '12']) {
        events.push({ exDate: `${y}-${m}-15`, amountPerShareMicros: cur });
      }
      cur = Math.round(cur * 1.05); // 5%/year raise
    }
    const classified = classifyDividends(events);
    const specials = classified.filter((c) => c.classification === 'special');
    expect(specials.length).toBe(0);
  });
});

describe('ttmRegularDividendPerShare', () => {
  test('excludes specials from the trailing total', () => {
    const events = mainStyleStream();
    const ttmAll = ttmDividendPerShare(events, '2025-12-31');
    const ttmReg = ttmRegularDividendPerShare(events, '2025-12-31');
    // Regular: 12 × $0.26 = $3.12
    // Total: $3.12 + 4 × $0.30 = $4.32
    expect(ttmReg).toBeCloseTo(3.12, 2);
    expect(ttmAll).toBeCloseTo(4.32, 2);
    expect(ttmAll).toBeGreaterThan(ttmReg);
  });
});

describe('forwardYield with specials', () => {
  test('annualizes only the regular cadence, not a special bonus', () => {
    // Stream where the most recent event is a $0.30 supplemental
    const events: DividendEventInput[] = [];
    for (let y = 2023; y <= 2024; y++) {
      for (let m = 1; m <= 12; m++) {
        events.push({
          exDate: `${y}-${String(m).padStart(2, '0')}-08`,
          amountPerShareMicros: 260_000,
        });
      }
    }
    // 2025 monthly through Sept then a supplemental on Sept 22
    for (let m = 1; m <= 9; m++) {
      events.push({
        exDate: `2025-${String(m).padStart(2, '0')}-08`,
        amountPerShareMicros: 260_000,
      });
    }
    events.push({ exDate: '2025-09-22', amountPerShareMicros: 300_000 });

    const priceCents = 5400; // $54
    const fwd = forwardYield(events, priceCents);
    // Should annualize $0.26 × 12 = $3.12 / $54 ≈ 5.78%, not $0.30 × 12 = $3.60.
    expect(fwd).not.toBeNull();
    expect(fwd!).toBeGreaterThan(0.05);
    expect(fwd!).toBeLessThan(0.06);
  });
});
