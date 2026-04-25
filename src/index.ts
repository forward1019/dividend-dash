/**
 * dividend-dash main entrypoint.
 *
 * For now this just prints a help message. The real entrypoints are the
 * sub-commands under src/cli/ which are wired up in package.json scripts.
 */

const HELP = `dividend-dash — personal dividend portfolio tracker

Commands:
  bun run migrate                                       Apply DB schema
  bun run ingest -- --broker=<name> --file=<path>       Import broker CSV
  bun run report                                        Print analytics report
  bun run brief -- --ticker=<TICKER>                    AI dividend brief
  bun run digest                                        Weekly Discord digest

See README.md and docs/plan.md for details.`;

console.log(HELP);
