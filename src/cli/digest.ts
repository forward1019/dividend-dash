#!/usr/bin/env bun
/**
 * `bun run digest [-- --dry-run] [-- --no-mc]`
 *
 * Builds the weekly digest and posts it to Discord (or prints if --dry-run).
 */

import { getDb } from '../db/db.ts';
import { buildDigest } from '../digest/build.ts';
import { postDigestToDiscord } from '../digest/discord.ts';
import { log } from '../lib/logger.ts';

interface Args {
  dryRun: boolean;
  noMc: boolean;
}

function parseArgs(argv: string[]): Args {
  return {
    dryRun: argv.includes('--dry-run'),
    noMc: argv.includes('--no-mc'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const db = getDb();

  const md = buildDigest(db, { includeMonteCarlo: !args.noMc });

  log.info(`built digest (${md.length} chars)`);

  if (args.dryRun) {
    console.log(md);
    return;
  }

  await postDigestToDiscord(md);
  log.info('digest posted to Discord');
}

if (import.meta.main) {
  await main();
}
