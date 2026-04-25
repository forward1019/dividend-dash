#!/usr/bin/env bun
/**
 * `bun run brief -- --ticker=<TICKER> [--earnings-file=<path>]`
 *
 * Generates an AI dividend brief and prints markdown to stdout.
 */

import { readFileSync } from 'node:fs';

import { formatBriefMarkdown, generateBrief } from '../ai/brief.ts';
import { log } from '../lib/logger.ts';

interface Args {
  ticker?: string;
  earningsFile?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const a of argv) {
    if (a.startsWith('--ticker=')) out.ticker = a.slice('--ticker='.length);
    else if (a.startsWith('--earnings-file='))
      out.earningsFile = a.slice('--earnings-file='.length);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  if (!args.ticker) {
    console.error('Usage: bun run brief -- --ticker=<TICKER> [--earnings-file=<path>]');
    process.exit(1);
  }

  const earningsCallText = args.earningsFile ? readFileSync(args.earningsFile, 'utf-8') : undefined;

  log.info('generating dividend brief', { ticker: args.ticker });
  const brief = await generateBrief(args.ticker, { earningsCallText });

  console.log(formatBriefMarkdown(brief));
  console.log('\n---\n```json');
  console.log(JSON.stringify(brief, null, 2));
  console.log('```');
}

if (import.meta.main) {
  await main();
}
