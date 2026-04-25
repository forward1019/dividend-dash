import { describe, expect, test } from 'bun:test';

import { splitForDiscord } from '../src/digest/discord.ts';

describe('splitForDiscord', () => {
  test('single chunk for short messages', () => {
    expect(splitForDiscord('hello')).toEqual(['hello']);
  });

  test('splits on paragraph breaks when possible', () => {
    const para = 'a'.repeat(1500);
    const long = `${para}\n\n${para}`;
    const chunks = splitForDiscord(long);
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.length).toBeLessThanOrEqual(1900);
    expect(chunks[1]!.length).toBeLessThanOrEqual(1900);
  });

  test('every chunk under limit even with no break points', () => {
    const noBreaks = 'x'.repeat(5000);
    const chunks = splitForDiscord(noBreaks);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1900);
    }
  });

  test('preserves total content', () => {
    const para = 'a'.repeat(1500);
    const long = `${para}\n\n${para}\n\n${para}`;
    const chunks = splitForDiscord(long);
    const stripped = chunks.join('').replace(/\s/g, '');
    expect(stripped.length).toBe(1500 * 3);
  });
});
