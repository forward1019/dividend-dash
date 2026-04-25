/**
 * Fidelity Positions export parser.
 *
 * Fidelity's "Download Portfolio Positions" CSV typically looks like:
 *   "Account Number","Account Name","Symbol","Description","Quantity",
 *   "Last Price","Current Value","Today's Gain/Loss Dollar","Total Gain/Loss Dollar",
 *   "Cost Basis Total","Type"
 *
 * Empty header rows, footer disclaimers, and pending-activity rows are
 * filtered out.
 */

import { dollarsToCents } from '../../lib/money.ts';
import { type Holding, HoldingSchema } from '../../types.ts';
import { parseCsvRow } from './manual.ts';

interface FidelityRow {
  accountNumber: string;
  symbol: string;
  description: string;
  quantity: number;
  costBasisTotal: number | null;
}

export interface FidelityParseResult {
  holdings: Holding[];
  errors: { row: number; error: string; raw: string[] }[];
}

const COLUMN_ALIASES: Record<string, string> = {
  'account number': 'accountNumber',
  symbol: 'symbol',
  description: 'description',
  quantity: 'quantity',
  'cost basis total': 'costBasisTotal',
  'cost basis': 'costBasisTotal',
};

function findHeaderIndex(line: string): {
  cols: string[];
  idx: Partial<Record<keyof FidelityRow, number>>;
} | null {
  const cols = parseCsvRow(line).map((c) => c.trim().toLowerCase());
  const idx: Partial<Record<keyof FidelityRow, number>> = {};
  for (let i = 0; i < cols.length; i++) {
    const alias = COLUMN_ALIASES[cols[i]!];
    if (alias) idx[alias as keyof FidelityRow] = i;
  }
  // Need at least symbol + quantity + accountNumber to be useful
  if (idx.symbol === undefined || idx.quantity === undefined || idx.accountNumber === undefined) {
    return null;
  }
  return { cols, idx };
}

function parseMoney(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,"]/g, '').trim();
  if (cleaned === '' || cleaned === '--' || cleaned === 'n/a') return null;
  const v = Number.parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
}

export function parseFidelityCsv(
  csv: string,
  opts: { asOfDate?: string } = {},
): FidelityParseResult {
  const lines = csv.split(/\r?\n/);
  let headerInfo: ReturnType<typeof findHeaderIndex> = null;
  let headerLineNum = -1;

  // Fidelity sometimes prefixes the file with blank lines or metadata.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.trim()) continue;
    const try_ = findHeaderIndex(lines[i]!);
    if (try_) {
      headerInfo = try_;
      headerLineNum = i;
      break;
    }
  }

  if (!headerInfo) {
    return {
      holdings: [],
      errors: [
        {
          row: 0,
          error: 'Could not find a Fidelity header row with Symbol/Quantity/Account',
          raw: [],
        },
      ],
    };
  }

  const { idx } = headerInfo;
  const today = opts.asOfDate ?? new Date().toISOString().slice(0, 10);
  const holdings: Holding[] = [];
  const errors: FidelityParseResult['errors'] = [];

  for (let i = headerLineNum + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    // Fidelity adds a footer like "Brokerage services provided by..."
    if (line.startsWith('"Date downloaded') || /provided by Fidelity/i.test(line)) break;

    const cols = parseCsvRow(line);
    if (cols.length < 3) continue;

    const symbolRaw = (cols[idx.symbol!] ?? '').trim();
    const qtyRaw = (cols[idx.quantity!] ?? '').trim();
    const acctRaw = (cols[idx.accountNumber!] ?? '').trim();

    // Skip "Pending Activity", cash, money market sweep, etc.
    if (!symbolRaw || /pending|cash|^\*/i.test(symbolRaw)) continue;
    if (!qtyRaw || qtyRaw === '--' || qtyRaw === 'n/a') continue;

    const shares = parseMoney(qtyRaw);
    if (shares === null) {
      errors.push({ row: i + 1, error: `invalid quantity: ${qtyRaw}`, raw: cols });
      continue;
    }

    const costRaw = idx.costBasisTotal !== undefined ? cols[idx.costBasisTotal] : undefined;
    const cost = parseMoney(costRaw);
    if (cost === null) {
      errors.push({ row: i + 1, error: 'missing cost basis', raw: cols });
      continue;
    }

    const candidate = {
      broker: 'fidelity' as const,
      account: maskAccount(acctRaw),
      ticker: symbolRaw.toUpperCase(),
      shares,
      costBasisCents: dollarsToCents(cost),
      asOfDate: today,
    };

    const parsed = HoldingSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.message, raw: cols });
      continue;
    }
    holdings.push(parsed.data);
  }

  return { holdings, errors };
}

function maskAccount(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 4) return raw || 'unknown';
  return `...${digits.slice(-4)}`;
}
