/**
 * Manual / generic CSV parser. Use this for 401(k) imports or any broker we
 * haven't built a dedicated parser for yet.
 *
 * Expected columns (header row required, case-insensitive):
 *   ticker         — required, uppercase symbol
 *   shares         — required, decimal
 *   cost_basis     — required, total dollars (e.g. "7500.00") OR cost_basis_cents (integer)
 *   account        — optional, defaults to "manual"
 *   broker         — optional, defaults to "manual"; one of fidelity|robinhood|ibkr|manual|401k
 *   as_of_date     — optional, defaults to today; ISO YYYY-MM-DD
 *   name           — optional, security display name
 */

import { z } from 'zod';

import { dollarsToCents } from '../../lib/money.ts';
import { BrokerSchema, type Holding, HoldingSchema } from '../../types.ts';

const RowSchema = z.object({
  ticker: z.string().min(1),
  shares: z.string().min(1),
  cost_basis: z.string().optional(),
  cost_basis_cents: z.string().optional(),
  account: z.string().optional(),
  broker: z.string().optional(),
  as_of_date: z.string().optional(),
  name: z.string().optional(),
});

export interface ParseResult {
  holdings: Holding[];
  errors: { row: number; error: string; raw: Record<string, string> }[];
}

/**
 * Parse a CSV string. Skips empty lines and rows missing required fields.
 * Header detection is case-insensitive.
 */
export function parseManualCsv(
  csv: string,
  opts: { defaultBroker?: string; defaultAccount?: string; defaultAsOfDate?: string } = {},
): ParseResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { holdings: [], errors: [] };
  }

  const headers = parseCsvRow(lines[0]!).map((h) => h.trim().toLowerCase());
  const holdings: Holding[] = [];
  const errors: ParseResult['errors'] = [];

  const today = new Date().toISOString().slice(0, 10);

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]!);
    const raw: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      raw[headers[j]!] = (cols[j] ?? '').trim();
    }

    const parsedRow = RowSchema.safeParse(raw);
    if (!parsedRow.success) {
      errors.push({ row: i + 1, error: parsedRow.error.message, raw });
      continue;
    }
    const r = parsedRow.data;

    const shares = Number.parseFloat(r.shares);
    if (!Number.isFinite(shares) || shares < 0) {
      errors.push({ row: i + 1, error: `invalid shares: ${r.shares}`, raw });
      continue;
    }

    let costBasisCents: number;
    if (r.cost_basis_cents) {
      const v = Number.parseInt(r.cost_basis_cents, 10);
      if (!Number.isFinite(v)) {
        errors.push({ row: i + 1, error: `invalid cost_basis_cents: ${r.cost_basis_cents}`, raw });
        continue;
      }
      costBasisCents = v;
    } else if (r.cost_basis) {
      const usd = Number.parseFloat(r.cost_basis.replace(/[$,]/g, ''));
      if (!Number.isFinite(usd)) {
        errors.push({ row: i + 1, error: `invalid cost_basis: ${r.cost_basis}`, raw });
        continue;
      }
      costBasisCents = dollarsToCents(usd);
    } else {
      errors.push({ row: i + 1, error: 'missing cost_basis or cost_basis_cents', raw });
      continue;
    }

    const candidate = {
      broker: r.broker ?? opts.defaultBroker ?? 'manual',
      account: r.account ?? opts.defaultAccount ?? 'manual',
      ticker: r.ticker.toUpperCase(),
      shares,
      costBasisCents,
      asOfDate: r.as_of_date ?? opts.defaultAsOfDate ?? today,
    };

    // Validate broker is one of allowed values
    const brokerCheck = BrokerSchema.safeParse(candidate.broker);
    if (!brokerCheck.success) {
      errors.push({
        row: i + 1,
        error: `invalid broker '${candidate.broker}'; allowed: ${BrokerSchema.options.join(', ')}`,
        raw,
      });
      continue;
    }

    const holding = HoldingSchema.safeParse(candidate);
    if (!holding.success) {
      errors.push({ row: i + 1, error: holding.error.message, raw });
      continue;
    }

    holdings.push(holding.data);
  }

  return { holdings, errors };
}

/**
 * Minimal CSV row parser supporting quoted fields with embedded commas.
 * Not RFC 4180 complete but sufficient for the broker exports we'll see.
 */
export function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"' && cur.length === 0) {
        inQuote = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}
