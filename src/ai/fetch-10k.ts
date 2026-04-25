/**
 * Fetch the latest 10-K filing for a ticker from SEC EDGAR.
 *
 * Strategy:
 *   1. Resolve ticker → CIK via SEC's company_tickers.json
 *   2. Fetch the company's recent submissions list
 *   3. Find the most recent 10-K, get the primary document URL
 *   4. Fetch and return the HTML/text (raw — caller decides how to chunk)
 */

import { isEtfOrMutualFund, tickerToCik } from '../ingest/sec-edgar.ts';
import { config } from '../lib/config.ts';

/**
 * Thrown when a ticker is recognized but cannot be analyzed by the brief
 * feature (today: ETFs and mutual funds, which file N-CSR not 10-K).
 */
export class UnsupportedFilingTypeError extends Error {
  constructor(
    readonly ticker: string,
    readonly reason: 'etf-or-mutual-fund' | 'no-10k-on-file',
    message: string,
  ) {
    super(message);
    this.name = 'UnsupportedFilingTypeError';
  }
}

interface SubmissionRecent {
  accessionNumber: string[];
  filingDate: string[];
  primaryDocument: string[];
  form: string[];
}

interface SubmissionResponse {
  cik: string;
  name: string;
  filings: {
    recent: SubmissionRecent;
  };
}

const ARCHIVE_BASE = 'https://www.sec.gov/Archives/edgar/data';

export interface TenKDocument {
  ticker: string;
  cik: string;
  filingDate: string;
  accession: string;
  url: string;
  /** Primary 10-K document content. May be HTML or text. */
  body: string;
}

/**
 * Fetch the most recent 10-K for `ticker`. Throws `UnsupportedFilingTypeError`
 * if the ticker is an ETF/mutual fund, has no 10-K on file (e.g. foreign
 * issuers that file 20-F), or otherwise cannot be analyzed by the brief
 * feature. Throws a plain Error for genuinely unknown tickers.
 */
export async function fetchLatest10K(ticker: string): Promise<TenKDocument> {
  const t = ticker.toUpperCase();
  const cik = await tickerToCik(t);
  if (!cik) {
    // The operating-company index doesn't have it. Check the ETF/mutual-fund
    // index so we can give a clear, actionable error.
    if (await isEtfOrMutualFund(t)) {
      throw new UnsupportedFilingTypeError(
        t,
        'etf-or-mutual-fund',
        `${t} is an ETF or mutual fund. The brief feature analyzes 10-K filings, which only operating companies (single stocks like JNJ, KO, MSFT) file. ETFs file N-CSR shareholder reports instead — not yet supported. Try running brief on one of the ETF's underlying single-stock holdings.`,
      );
    }
    throw new Error(
      `Could not resolve CIK for ${t}. Check the ticker is correct and traded on a US exchange.`,
    );
  }

  const subsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const subs = await fetchJson<SubmissionResponse>(subsUrl);

  const recent = subs.filings.recent;
  let idx = -1;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] === '10-K') {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    throw new UnsupportedFilingTypeError(
      t,
      'no-10k-on-file',
      `${t} (${subs.name}) has no 10-K on file at SEC EDGAR. This usually means it's a foreign issuer (which files 20-F instead) or a holding company with non-standard reporting. Not yet supported by the brief feature.`,
    );
  }

  const accession = recent.accessionNumber[idx]!;
  const accessionPath = accession.replace(/-/g, '');
  const primaryDoc = recent.primaryDocument[idx]!;

  const docUrl = `${ARCHIVE_BASE}/${stripLeadingZeros(cik)}/${accessionPath}/${primaryDoc}`;

  const body = await fetchText(docUrl);

  return {
    ticker: t,
    cik,
    filingDate: recent.filingDate[idx]!,
    accession,
    url: docUrl,
    body,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.secEdgarUserAgent, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`SEC fetch failed: ${url} → ${res.status}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.secEdgarUserAgent, Accept: 'text/html, text/plain' },
  });
  if (!res.ok) throw new Error(`SEC fetch failed: ${url} → ${res.status}`);
  return res.text();
}

function stripLeadingZeros(cik: string): string {
  return cik.replace(/^0+/, '') || '0';
}

/**
 * Strip HTML tags + collapse whitespace from a 10-K body. Simple regex
 * approach — robust enough because 10-K plain text after this is good
 * enough for an LLM context window.
 */
export function plainTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the section of a 10-K most relevant to dividend analysis. We look
 * for the Liquidity / Capital Resources / Dividends sections. Falls back to
 * a leading window if those aren't found.
 */
export function extractDividendSection(text: string, maxChars = 60_000): string {
  const lower = text.toLowerCase();
  const markers = [
    'dividend',
    'liquidity and capital resources',
    'cash dividends',
    'capital allocation',
  ];
  let bestIdx = -1;
  for (const m of markers) {
    const i = lower.indexOf(m);
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx === -1) {
    return text.slice(0, maxChars);
  }
  // Take a window around the first dividend-related marker.
  const start = Math.max(0, bestIdx - 1000);
  return text.slice(start, start + maxChars);
}
