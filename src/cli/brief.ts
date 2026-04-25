#!/usr/bin/env bun
/**
 * `bun run brief -- --ticker=<TICKER> [--earnings-file=<path>]`
 *
 * Generates an AI dividend brief and prints markdown to stdout.
 */

import { readFileSync } from 'node:fs';

import { formatBriefMarkdown, generateBrief } from '../ai/brief.ts';
import { UnsupportedFilingTypeError } from '../ai/fetch-10k.ts';
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
  try {
    const brief = await generateBrief(args.ticker, { earningsCallText });
    console.log(formatBriefMarkdown(brief));
    console.log('\n---\n```json');
    console.log(JSON.stringify(brief, null, 2));
    console.log('```');
  } catch (err) {
    if (err instanceof UnsupportedFilingTypeError) {
      console.error(`\n⚠️  ${err.message}\n`);
      process.exit(2);
    }
    // Surface other expected user-facing errors (bad ticker, network,
    // SEC throttling) without the noisy stack trace.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('Could not resolve CIK')) {
      console.error(`\n⚠️  ${msg}\n`);
      process.exit(2);
    }
    throw err;
  }
}

if (import.meta.main) {
  await main();
}
