#!/usr/bin/env bun
/**
 * `bun run ingest -- --broker=<name> --file=<path>`
 *
 * Phase 0 stub. Phase 1 wires up the per-broker CSV parsers in src/ingest/csv/.
 */

import { log } from '../lib/logger.ts';
import { BrokerSchema } from '../types.ts';

interface Args {
  broker?: string;
  file?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const a of argv) {
    if (a.startsWith('--broker=')) args.broker = a.slice('--broker='.length);
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
  }
  return args;
}

async function main(): Promise<void> {
  const { broker, file } = parseArgs(Bun.argv.slice(2));

  if (!broker || !file) {
    console.error(
      'Usage: bun run ingest -- --broker=<fidelity|robinhood|ibkr|manual|401k> --file=<path>',
    );
    process.exit(1);
  }

  const brokerParsed = BrokerSchema.safeParse(broker);
  if (!brokerParsed.success) {
    console.error(`Unknown broker: ${broker}. Allowed: ${BrokerSchema.options.join(', ')}`);
    process.exit(1);
  }

  log.info('ingest invoked', { broker: brokerParsed.data, file });
  console.log('Phase 0 stub — broker CSV parsers ship in Phase 1. See docs/plan.md.');
}

if (import.meta.main) {
  await main();
}
