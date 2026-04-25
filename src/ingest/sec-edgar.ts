/**
 * SEC EDGAR client. Used for:
 *   - resolving ticker → CIK
 *   - fetching official dividend declarations from filings (8-K, 10-Q, 10-K)
 *
 * SEC requires a `User-Agent` identifying the requester. See SEC_EDGAR_USER_AGENT
 * in .env.example.
 *
 * Phase 1 ships ticker → CIK resolution and filing index fetch. Filing-content
 * parsing (extracting declared dividend amounts) is Phase 3.
 */

import { z } from 'zod';

import { config } from '../lib/config.ts';
import { log } from '../lib/logger.ts';

const TICKER_TO_CIK_URL = 'https://www.sec.gov/files/company_tickers.json';
// ETFs and mutual funds live in a separate SEC index. We use this purely for
// diagnostics — to tell the user "you tried an ETF, brief is for single stocks".
const MF_TICKER_URL = 'https://www.sec.gov/files/company_tickers_mf.json';

const TickerEntrySchema = z.object({
  cik_str: z.number(),
  ticker: z.string(),
  title: z.string(),
});

const TickerMapSchema = z.record(z.string(), TickerEntrySchema);

let _tickerCache: Map<string, { cik: string; name: string }> | null = null;
let _mfTickerCache: Set<string> | null = null;

function pad10(cik: number | string): string {
  const s = typeof cik === 'string' ? cik : String(cik);
  return s.padStart(10, '0');
}

export async function loadTickerToCikMap(): Promise<Map<string, { cik: string; name: string }>> {
  if (_tickerCache) return _tickerCache;

  const res = await fetch(TICKER_TO_CIK_URL, {
    headers: {
      'User-Agent': config.secEdgarUserAgent,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`SEC EDGAR ticker map fetch failed: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  const parsed = TickerMapSchema.safeParse(json);
  if (!parsed.success) {
    log.warn('SEC ticker map shape changed', { issues: parsed.error.issues.slice(0, 3) });
  }
  // Be defensive: even if Zod fails, try to extract entries we recognize
  const map = new Map<string, { cik: string; name: string }>();
  for (const v of Object.values(json as Record<string, unknown>)) {
    const e = TickerEntrySchema.safeParse(v);
    if (e.success) {
      map.set(e.data.ticker.toUpperCase(), {
        cik: pad10(e.data.cik_str),
        name: e.data.title,
      });
    }
  }
  _tickerCache = map;
  return map;
}

export async function tickerToCik(ticker: string): Promise<string | null> {
  const map = await loadTickerToCikMap();
  return map.get(ticker.toUpperCase())?.cik ?? null;
}

/**
 * True if `ticker` appears in SEC's mutual-fund/ETF index. Used to give a
 * helpful error when someone tries `bun run brief` against an ETF — ETFs
 * file N-CSR shareholder reports, not 10-Ks, so the brief generator can't
 * analyze them today.
 */
export async function isEtfOrMutualFund(ticker: string): Promise<boolean> {
  if (_mfTickerCache) return _mfTickerCache.has(ticker.toUpperCase());

  const res = await fetch(MF_TICKER_URL, {
    headers: {
      'User-Agent': config.secEdgarUserAgent,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    log.warn('SEC mutual-fund ticker map fetch failed', { status: res.status });
    _mfTickerCache = new Set();
    return false;
  }
  const json = (await res.json()) as { fields: string[]; data: unknown[][] };
  const symbolIdx = json.fields.indexOf('symbol');
  const set = new Set<string>();
  if (symbolIdx >= 0) {
    for (const row of json.data) {
      const sym = row[symbolIdx];
      if (typeof sym === 'string') set.add(sym.toUpperCase());
    }
  }
  _mfTickerCache = set;
  return set.has(ticker.toUpperCase());
}

export async function fetchSubmissions(cik: string): Promise<unknown> {
  const url = `https://data.sec.gov/submissions/CIK${pad10(cik)}.json`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': config.secEdgarUserAgent,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`SEC submissions fetch failed for CIK ${cik}: ${res.status}`);
  }
  return res.json();
}
