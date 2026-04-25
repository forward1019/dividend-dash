/**
 * Discord webhook poster. Splits long messages at safe boundaries (Discord
 * caps at 2000 chars per message).
 */

import { requireConfig } from '../lib/config.ts';
import { log } from '../lib/logger.ts';

const DISCORD_LIMIT = 1900; // a bit under 2000 to be safe

export async function postDigestToDiscord(
  markdown: string,
  opts: { dryRun?: boolean } = {},
): Promise<void> {
  if (opts.dryRun) {
    console.log('--- DRY RUN ---\n');
    console.log(markdown);
    return;
  }

  const url = requireConfig('discordWebhookUrl');
  const chunks = splitForDiscord(markdown);

  for (let i = 0; i < chunks.length; i++) {
    const body = JSON.stringify({
      content: chunks[i],
      // Use a custom username if Discord allows; webhook owner can override
      username: 'dividend-dash',
    });
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Discord webhook failed: ${res.status} ${text}`);
    }
    log.debug(`posted chunk ${i + 1}/${chunks.length}`);
    // Be polite to Discord rate limits between chunks
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 750));
  }
}

/**
 * Split a long markdown message into Discord-safe chunks. Tries to split on
 * blank lines first, then on single newlines, then hard-cuts.
 */
export function splitForDiscord(markdown: string, limit = DISCORD_LIMIT): string[] {
  if (markdown.length <= limit) return [markdown];

  const out: string[] = [];
  let remaining = markdown;

  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < limit / 2) cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = limit;

    out.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, '');
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}
