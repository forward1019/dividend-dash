/**
 * Seedable PRNG for Monte Carlo simulations. Using mulberry32 — small,
 * fast, well-distributed, and trivially testable with a fixed seed.
 */

export interface Rng {
  next(): number; // uniform [0, 1)
  normal(mean?: number, stdDev?: number): number;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  let spareNormal: number | null = null;

  function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Box-Muller transform with caching for the spare value
  function normal(mean = 0, stdDev = 1): number {
    if (spareNormal !== null) {
      const v = spareNormal;
      spareNormal = null;
      return mean + v * stdDev;
    }
    let u1 = 0;
    let u2 = 0;
    while (u1 === 0) u1 = next(); // avoid log(0)
    u2 = next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spareNormal = r * Math.sin(theta);
    return mean + r * Math.cos(theta) * stdDev;
  }

  return { next, normal };
}
