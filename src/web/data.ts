/**
 * Data accessor layer for the web dashboard. Pure read-only helpers that
 * compute every metric the UI needs from SQLite + analytics modules.
 *
 * Everything cached to a 60-second in-memory map so a dashboard refresh
 * doesn't re-query 60 tickers' worth of analytics.
 */

import { Database } from 'bun:sqlite';

import {
  type DividendEventInput,
  classifyDividends,
  detectFrequency,
  dividendCagr,
  forwardYield,
  growthStreakYears,
  trailingYield,
  ttmDividendPerShare,
  ttmRegularDividendPerShare,
} from '../analytics/dividend-stats.ts';
import { type SustainabilityScore, scoreSustainability } from '../analytics/sustainability.ts';
import { config } from '../lib/config.ts';
import { microsToDollars } from '../lib/money.ts';
import {
  CATEGORY_LABELS,
  DIVIDEND_UNIVERSE,
  type UniverseCategory,
  type UniverseTicker,
} from './tickers.ts';

const _db = new Database(config.dbPath, { create: true });

export function getDb(): Database {
  return _db;
}

// === Cache ===
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { value: unknown; until: number }>();
function memo<T>(key: string, fn: () => T): T {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.value as T;
  const value = fn();
  cache.set(key, { value, until: now + CACHE_TTL_MS });
  return value;
}
export function clearCache(): void {
  cache.clear();
}

// === Types ===

export interface TickerCard {
  ticker: string;
  name: string;
  category: UniverseCategory;
  categoryLabel: string;
  kind: 'etf' | 'stock';
  notes?: string;
  // pricing
  priceCents: number | null;
  priceAsOf: string | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  // dividends
  ttmDps: number | null; // dollars (incl. specials — what was actually paid)
  ttmDpsRegular: number | null; // dollars (regular only — what's recurring)
  hasSpecialDividends: boolean; // true if a special was detected in the last 24mo
  forwardYield: number | null; // 0..1 — based on regular cadence only
  trailingYield: number | null; // 0..1 — TTM realized incl. specials
  cagr5y: number | null; // 0..1
  cagr10y: number | null;
  growthStreak: number;
  frequency: string;
  lastDividend: { exDate: string; amount: number } | null; // amount = dollars
  // sustainability
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  sustainability: SustainabilityScore;
  // misc
  hasFundamentals: boolean;
}

export interface DividendHistoryPoint {
  exDate: string;
  amount: number; // dollars per share
}

export interface PricePoint {
  date: string;
  closeCents: number;
}

export interface YocPoint {
  date: string;
  yoc: number; // 0..1
}

export interface CalendarEntry {
  ticker: string;
  name: string;
  exDate: string;
  payDate: string | null;
  amount: number; // dollars
  daysUntil: number;
}

// === Queries ===

export function getDividendEvents(ticker: string): DividendEventInput[] {
  const db = getDb();
  return db
    .query<{ ex_date: string; amount_per_share_micros: number }, [string]>(
      `SELECT ex_date, amount_per_share_micros FROM dividend_events
       WHERE ticker = ? AND source = 'yfinance' ORDER BY ex_date ASC`,
    )
    .all(ticker.toUpperCase())
    .map((r) => ({ exDate: r.ex_date, amountPerShareMicros: r.amount_per_share_micros }));
}

export function getDividendHistory(ticker: string): DividendHistoryPoint[] {
  return getDividendEvents(ticker).map((e) => ({
    exDate: e.exDate,
    amount: microsToDollars(e.amountPerShareMicros),
  }));
}

export function getLatestPrice(ticker: string): { priceCents: number; date: string } | null {
  const db = getDb();
  const row = db
    .query<{ close_cents: number; date: string }, [string]>(
      'SELECT close_cents, date FROM prices WHERE ticker = ? ORDER BY date DESC LIMIT 1',
    )
    .get(ticker.toUpperCase());
  if (!row) return null;
  return { priceCents: row.close_cents, date: row.date };
}

export function getLatestFundamentals(ticker: string): {
  payoutRatio: number | null;
  fcfPayoutRatio: number | null;
  debtToEquity: number | null;
  asOfDate: string;
} | null {
  const db = getDb();
  const row = db
    .query<
      {
        payout_ratio: number | null;
        fcf_payout_ratio: number | null;
        debt_to_equity: number | null;
        as_of_date: string;
      },
      [string]
    >(
      `SELECT payout_ratio, fcf_payout_ratio, debt_to_equity, as_of_date
       FROM fundamentals WHERE ticker = ? ORDER BY as_of_date DESC LIMIT 1`,
    )
    .get(ticker.toUpperCase());
  if (!row) return null;
  return {
    payoutRatio: row.payout_ratio,
    fcfPayoutRatio: row.fcf_payout_ratio,
    debtToEquity: row.debt_to_equity,
    asOfDate: row.as_of_date,
  };
}

export function getSecurityMeta(ticker: string): {
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
} | null {
  const db = getDb();
  const row = db
    .query<
      {
        name: string;
        sector: string | null;
        industry: string | null;
        exchange: string | null;
      },
      [string]
    >('SELECT name, sector, industry, exchange FROM securities WHERE ticker = ?')
    .get(ticker.toUpperCase());
  return row ?? null;
}

export function getQuoteFromYf(ticker: string): {
  high: number | null;
  low: number | null;
} | null {
  // We don't store 52w high/low in the schema. The dashboard derives them
  // from the price series for now.
  const db = getDb();
  const rows = db
    .query<{ high: number | null; low: number | null }, [string]>(
      `SELECT MAX(close_cents) AS high, MIN(close_cents) AS low
       FROM prices WHERE ticker = ?
         AND date >= date('now', '-365 days')`,
    )
    .get(ticker.toUpperCase());
  if (!rows) return null;
  return rows;
}

// === Quote snapshot (rich market data — v0.4) ===

export interface QuoteSnapshotRow {
  ticker: string;
  fetchDate: string;
  shortName: string | null;
  longName: string | null;
  exchange: string | null;
  currency: string | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  summary: string | null;
  website: string | null;
  price: number | null;
  marketCap: number | null;
  volume: number | null;
  avgVolume3m: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekChangePct: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  peTrailing: number | null;
  peForward: number | null;
  psRatio: number | null;
  pbRatio: number | null;
  pegRatio: number | null;
  enterpriseValue: number | null;
  evToRevenue: number | null;
  evToEbitda: number | null;
  freeCashFlow: number | null;
  operatingCashFlow: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  profitMargins: number | null;
  dividendRate: number | null;
  dividendYield: number | null;
  payoutRatio: number | null;
  exDividendDate: string | null;
  expenseRatio: number | null;
  totalAssets: number | null;
  fundFamily: string | null;
  inceptionDate: string | null;
  ytdReturn: number | null;
  threeYearReturn: number | null;
  fiveYearReturn: number | null;
}

export function getLatestQuoteSnapshot(ticker: string): QuoteSnapshotRow | null {
  const db = getDb();
  const row = db
    .query<
      {
        ticker: string;
        fetch_date: string;
        short_name: string | null;
        long_name: string | null;
        exchange: string | null;
        currency: string | null;
        quote_type: string | null;
        sector: string | null;
        industry: string | null;
        summary: string | null;
        website: string | null;
        price: number | null;
        market_cap: number | null;
        volume: number | null;
        avg_volume_3m: number | null;
        beta: number | null;
        fifty_two_week_high: number | null;
        fifty_two_week_low: number | null;
        fifty_two_week_change_pct: number | null;
        eps_trailing: number | null;
        eps_forward: number | null;
        pe_trailing: number | null;
        pe_forward: number | null;
        ps_ratio: number | null;
        pb_ratio: number | null;
        peg_ratio: number | null;
        enterprise_value: number | null;
        ev_to_revenue: number | null;
        ev_to_ebitda: number | null;
        free_cash_flow: number | null;
        operating_cash_flow: number | null;
        total_debt: number | null;
        total_cash: number | null;
        return_on_equity: number | null;
        return_on_assets: number | null;
        profit_margins: number | null;
        dividend_rate: number | null;
        dividend_yield: number | null;
        payout_ratio: number | null;
        ex_dividend_date: string | null;
        expense_ratio: number | null;
        total_assets: number | null;
        fund_family: string | null;
        inception_date: string | null;
        ytd_return: number | null;
        three_year_return: number | null;
        five_year_return: number | null;
      },
      [string]
    >('SELECT * FROM quote_snapshot WHERE ticker = ? ORDER BY fetch_date DESC LIMIT 1')
    .get(ticker.toUpperCase());
  if (!row) return null;
  return {
    ticker: row.ticker,
    fetchDate: row.fetch_date,
    shortName: row.short_name,
    longName: row.long_name,
    exchange: row.exchange,
    currency: row.currency,
    quoteType: row.quote_type,
    sector: row.sector,
    industry: row.industry,
    summary: row.summary,
    website: row.website,
    price: row.price,
    marketCap: row.market_cap,
    volume: row.volume,
    avgVolume3m: row.avg_volume_3m,
    beta: row.beta,
    fiftyTwoWeekHigh: row.fifty_two_week_high,
    fiftyTwoWeekLow: row.fifty_two_week_low,
    fiftyTwoWeekChangePct: row.fifty_two_week_change_pct,
    epsTrailing: row.eps_trailing,
    epsForward: row.eps_forward,
    peTrailing: row.pe_trailing,
    peForward: row.pe_forward,
    psRatio: row.ps_ratio,
    pbRatio: row.pb_ratio,
    pegRatio: row.peg_ratio,
    enterpriseValue: row.enterprise_value,
    evToRevenue: row.ev_to_revenue,
    evToEbitda: row.ev_to_ebitda,
    freeCashFlow: row.free_cash_flow,
    operatingCashFlow: row.operating_cash_flow,
    totalDebt: row.total_debt,
    totalCash: row.total_cash,
    returnOnEquity: row.return_on_equity,
    returnOnAssets: row.return_on_assets,
    profitMargins: row.profit_margins,
    dividendRate: row.dividend_rate,
    dividendYield: row.dividend_yield,
    payoutRatio: row.payout_ratio,
    exDividendDate: row.ex_dividend_date,
    expenseRatio: row.expense_ratio,
    totalAssets: row.total_assets,
    fundFamily: row.fund_family,
    inceptionDate: row.inception_date,
    ytdReturn: row.ytd_return,
    threeYearReturn: row.three_year_return,
    fiveYearReturn: row.five_year_return,
  };
}

// === ETF holdings (v0.4) ===

export interface EtfHoldingRow {
  position: number;
  symbol: string | null;
  name: string;
  allocationPct: number;
}

export interface EtfProfileRow {
  fetchDate: string;
  totalHoldings: number | null;
  sectorWeights: { sector: string; pct: number }[];
}

export function getEtfHoldings(ticker: string): EtfHoldingRow[] {
  const db = getDb();
  // Pull holdings from the most recent fetch.
  const latest = db
    .query<{ fetch_date: string }, [string]>(
      'SELECT MAX(fetch_date) as fetch_date FROM etf_holdings WHERE etf_ticker = ?',
    )
    .get(ticker.toUpperCase());
  if (!latest?.fetch_date) return [];
  const rows = db
    .query<
      {
        position: number;
        holding_symbol: string | null;
        holding_name: string;
        allocation_pct: number;
      },
      [string, string]
    >(
      `SELECT position, holding_symbol, holding_name, allocation_pct
       FROM etf_holdings
       WHERE etf_ticker = ? AND fetch_date = ?
       ORDER BY position ASC`,
    )
    .all(ticker.toUpperCase(), latest.fetch_date);
  return rows.map((r) => ({
    position: r.position,
    symbol: r.holding_symbol,
    name: r.holding_name,
    allocationPct: r.allocation_pct,
  }));
}

export function getEtfProfile(ticker: string): EtfProfileRow | null {
  const db = getDb();
  const row = db
    .query<
      {
        fetch_date: string;
        total_holdings: number | null;
        sector_weights_json: string | null;
      },
      [string]
    >(
      `SELECT fetch_date, total_holdings, sector_weights_json
       FROM etf_profile
       WHERE etf_ticker = ?
       ORDER BY fetch_date DESC LIMIT 1`,
    )
    .get(ticker.toUpperCase());
  if (!row) return null;
  let sectorWeights: { sector: string; pct: number }[] = [];
  if (row.sector_weights_json) {
    try {
      const parsed = JSON.parse(row.sector_weights_json);
      if (Array.isArray(parsed)) {
        sectorWeights = parsed.filter(
          (s) => typeof s?.sector === 'string' && typeof s?.pct === 'number',
        );
      }
    } catch {
      sectorWeights = [];
    }
  }
  return {
    fetchDate: row.fetch_date,
    totalHoldings: row.total_holdings,
    sectorWeights,
  };
}

// === News (v0.4) ===

export interface NewsRow {
  link: string;
  title: string;
  publisher: string | null;
  publishedAt: string;
  summary: string | null;
  thumbnailUrl: string | null;
}

export function getTickerNews(ticker: string, limit = 10): NewsRow[] {
  const db = getDb();
  const rows = db
    .query<
      {
        link: string;
        title: string;
        publisher: string | null;
        published_at: string;
        summary: string | null;
        thumbnail_url: string | null;
      },
      [string, number]
    >(
      `SELECT link, title, publisher, published_at, summary, thumbnail_url
       FROM ticker_news
       WHERE ticker = ?
       ORDER BY published_at DESC
       LIMIT ?`,
    )
    .all(ticker.toUpperCase(), limit);
  return rows.map((r) => ({
    link: r.link,
    title: r.title,
    publisher: r.publisher,
    publishedAt: r.published_at,
    summary: r.summary,
    thumbnailUrl: r.thumbnail_url,
  }));
}

/**
 * Tickers in the `mlp_other` category that are MLPs (publicly traded
 * partnerships issuing K-1s), not BDCs. yfinance reports GAAP-style FCF
 * for MLPs that bears no relation to distributable cash flow (DCF), so
 * the scorer needs to clamp those FCF ratios as data noise rather than
 * solvency signal. See sustainability.ts MLP_FCF_NOISE_THRESHOLD.
 *
 * If the universe ever gains a way to mark MLPs structurally (e.g. an
 * `issuerType` field on UniverseTicker), this set should move there.
 */
const MLP_TICKERS: ReadonlySet<string> = new Set(['EPD', 'ET']);

/**
 * Map the universe's editorial category onto the structural `securityKind`
 * used by the sustainability scorer. REITs, BDCs, and MLPs each get
 * special-case treatment because their GAAP payout / FCF figures don't
 * map cleanly onto a "is the dividend safe?" question.
 */
function securityKindFromCategory(
  category: UniverseCategory,
  kind: 'etf' | 'stock',
  ticker: string,
): 'stock' | 'etf' | 'reit' | 'bdc' | 'mlp' {
  if (kind === 'etf') return 'etf';
  if (category === 'reit') return 'reit';
  if (category === 'mlp_other') return MLP_TICKERS.has(ticker) ? 'mlp' : 'bdc';
  return 'stock';
}

// === Card builder ===

export function buildTickerCard(u: UniverseTicker): TickerCard {
  return memo(`card:${u.ticker}`, () => {
    const events = getDividendEvents(u.ticker);
    const price = getLatestPrice(u.ticker);
    const fund = getLatestFundamentals(u.ticker);
    const meta = getSecurityMeta(u.ticker);

    const priceCents = price?.priceCents ?? null;
    const fwd = priceCents !== null ? forwardYield(events, priceCents) : null;
    const trail = priceCents !== null ? trailingYield(events, priceCents) : null;
    const ttm = events.length > 0 ? ttmDividendPerShare(events) : null;
    const ttmRegular = events.length > 0 ? ttmRegularDividendPerShare(events) : null;
    // Did we see a special dividend in the last 24 months? Drives the
    // dashboard "regular vs total" disclosure.
    const hasSpecials = (() => {
      if (events.length === 0) return false;
      const cutoff = (() => {
        const d = new Date();
        d.setUTCFullYear(d.getUTCFullYear() - 2);
        return d.toISOString().slice(0, 10);
      })();
      return classifyDividends(events).some(
        (c) => c.classification === 'special' && c.exDate >= cutoff,
      );
    })();
    const c5 = dividendCagr(events, 5);
    const c10 = dividendCagr(events, 10);
    const streak = growthStreakYears(events);
    const freq = detectFrequency(events);

    const last = events.length > 0 ? events[events.length - 1]! : null;
    const lastDividend = last
      ? { exDate: last.exDate, amount: microsToDollars(last.amountPerShareMicros) }
      : null;

    const sust = scoreSustainability({
      payoutRatio: fund?.payoutRatio ?? null,
      fcfPayoutRatio: fund?.fcfPayoutRatio ?? null,
      growthStreakYears: streak,
      debtToEquity: fund?.debtToEquity ?? null,
      securityKind: securityKindFromCategory(u.category, u.kind, u.ticker),
    });

    const high52 = (() => {
      const r = getQuoteFromYf(u.ticker);
      return r?.high ?? null;
    })();
    const low52 = (() => {
      const r = getQuoteFromYf(u.ticker);
      return r?.low ?? null;
    })();

    return {
      ticker: u.ticker,
      name: meta?.name ?? u.name,
      category: u.category,
      categoryLabel: CATEGORY_LABELS[u.category],
      kind: u.kind,
      notes: u.notes,
      priceCents,
      priceAsOf: price?.date ?? null,
      fiftyTwoWeekHigh: high52,
      fiftyTwoWeekLow: low52,
      ttmDps: ttm,
      ttmDpsRegular: ttmRegular,
      hasSpecialDividends: hasSpecials,
      forwardYield: fwd,
      trailingYield: trail,
      cagr5y: c5,
      cagr10y: c10,
      growthStreak: streak,
      frequency: freq,
      lastDividend,
      payoutRatio: fund?.payoutRatio ?? null,
      fcfPayoutRatio: fund?.fcfPayoutRatio ?? null,
      debtToEquity: fund?.debtToEquity ?? null,
      sustainability: sust,
      hasFundamentals: fund !== null,
    };
  });
}

export function buildAllCards(): TickerCard[] {
  return DIVIDEND_UNIVERSE.map(buildTickerCard);
}

// === Dividend calendar ===

/**
 * Estimate upcoming ex-dividend dates by extrapolating the last known
 * payment forward by the detected frequency. Real ex-dates are
 * announced 1–2 quarters out — yfinance includes them in the chart
 * results when known. We'll take what we can get.
 */
export function buildCalendar(daysAhead = 90): CalendarEntry[] {
  return memo(`calendar:${daysAhead}`, () => {
    const today = new Date();
    const out: CalendarEntry[] = [];
    for (const u of DIVIDEND_UNIVERSE) {
      const events = getDividendEvents(u.ticker);
      if (events.length === 0) continue;
      const last = events[events.length - 1]!;
      const freq = detectFrequency(events);
      const stride = (
        {
          monthly: 30,
          quarterly: 91,
          semiannual: 182,
          annual: 365,
          special: 365,
          unknown: 91,
        } as const
      )[freq];

      const lastEx = new Date(last.exDate);
      let next = new Date(lastEx);
      next.setDate(next.getDate() + stride);

      // If "next" is already in the past, walk forward until in the future
      while (next.getTime() < today.getTime()) {
        next = new Date(next.getTime() + stride * 86400 * 1000);
      }

      const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400_000);
      if (daysUntil > daysAhead) continue;

      const meta = getSecurityMeta(u.ticker);
      out.push({
        ticker: u.ticker,
        name: meta?.name ?? u.name,
        exDate: next.toISOString().slice(0, 10),
        payDate: null,
        amount: microsToDollars(last.amountPerShareMicros),
        daysUntil,
      });
    }
    out.sort((a, b) => a.daysUntil - b.daysUntil);
    return out;
  });
}

// === Universe analytics (v0.5 dashboard) ===

export interface UniverseStats {
  /** Universe size & breakdown */
  total: number;
  etfCount: number;
  stockCount: number;

  /** Yield distribution: histogram bins (each bin: { range: '0-2%', count: N }) */
  yieldHistogram: { label: string; min: number; max: number; count: number }[];

  /** Sector exposure (counts of tickers in each sector across universe). */
  sectorMix: { sector: string; count: number; pct: number }[];

  /** Frequency mix: monthly / quarterly / etc */
  frequencyMix: { frequency: string; count: number; pct: number }[];

  /** Aggregate metrics */
  avgForwardYield: number;
  avgSustainability: number;
  avgPayoutRatio: number;
  totalDividendEvents: number;
}

const YIELD_BINS: { label: string; min: number; max: number }[] = [
  { label: '0-2%', min: 0, max: 0.02 },
  { label: '2-3%', min: 0.02, max: 0.03 },
  { label: '3-4%', min: 0.03, max: 0.04 },
  { label: '4-5%', min: 0.04, max: 0.05 },
  { label: '5-6%', min: 0.05, max: 0.06 },
  { label: '6-8%', min: 0.06, max: 0.08 },
  { label: '8%+', min: 0.08, max: Number.POSITIVE_INFINITY },
];

export function buildUniverseStats(cards: TickerCard[]): UniverseStats {
  const total = cards.length;
  const etfCount = cards.filter((c) => c.kind === 'etf').length;
  const stockCount = total - etfCount;

  // Yield histogram
  const yieldHistogram = YIELD_BINS.map((b) => ({
    ...b,
    count: cards.filter(
      (c) => c.forwardYield !== null && c.forwardYield >= b.min && c.forwardYield < b.max,
    ).length,
  }));

  // Sector mix — pull from quote_snapshot.sector when present, else
  // fall back to the universe categoryLabel to keep the chart populated.
  const sectorMap = new Map<string, number>();
  for (const c of cards) {
    const snap = getLatestQuoteSnapshot(c.ticker);
    const sector =
      snap?.sector && snap.sector.trim() !== ''
        ? snap.sector
        : c.kind === 'etf'
          ? `${c.categoryLabel}`
          : c.categoryLabel;
    sectorMap.set(sector, (sectorMap.get(sector) ?? 0) + 1);
  }
  const sectorEntries = Array.from(sectorMap.entries()).sort((a, b) => b[1] - a[1]);
  const sectorMix = sectorEntries.map(([sector, count]) => ({
    sector,
    count,
    pct: count / total,
  }));

  // Frequency mix
  const freqMap = new Map<string, number>();
  for (const c of cards) {
    freqMap.set(c.frequency, (freqMap.get(c.frequency) ?? 0) + 1);
  }
  const freqEntries = Array.from(freqMap.entries()).sort((a, b) => b[1] - a[1]);
  const frequencyMix = freqEntries.map(([frequency, count]) => ({
    frequency,
    count,
    pct: count / total,
  }));

  // Aggregates
  const yields = cards.map((c) => c.forwardYield).filter((y): y is number => y !== null && y > 0);
  const avgForwardYield = yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
  const sustScores = cards.map((c) => c.sustainability.total);
  const avgSustainability =
    sustScores.length > 0 ? sustScores.reduce((a, b) => a + b, 0) / sustScores.length : 0;
  const payoutRatios = cards
    .map((c) => c.payoutRatio)
    .filter((p): p is number => p !== null && p > 0 && p < 5);
  const avgPayoutRatio =
    payoutRatios.length > 0 ? payoutRatios.reduce((a, b) => a + b, 0) / payoutRatios.length : 0;

  const totalDividendEvents = cards.reduce((acc, c) => acc + getDividendEvents(c.ticker).length, 0);

  return {
    total,
    etfCount,
    stockCount,
    yieldHistogram,
    sectorMix,
    frequencyMix,
    avgForwardYield,
    avgSustainability,
    avgPayoutRatio,
    totalDividendEvents,
  };
}

/** Income outlook: bucket upcoming payments into 30/60/90 day windows. */
export interface IncomeOutlook {
  next30: { count: number; estPerShare: number };
  next60: { count: number; estPerShare: number };
  next90: { count: number; estPerShare: number };
  /** Top upcoming payments by amount, soonest first. */
  topUpcoming: CalendarEntry[];
  /** Per-week buckets for next 13 weeks (0..12). */
  weeklyBuckets: { weekIndex: number; count: number; estPerShare: number }[];
}

export function buildIncomeOutlook(): IncomeOutlook {
  return memo('income-outlook', () => {
    const upcoming = buildCalendar(90);

    let n30 = 0;
    let n60 = 0;
    let n90 = 0;
    let s30 = 0;
    let s60 = 0;
    let s90 = 0;
    for (const e of upcoming) {
      if (e.daysUntil <= 30) {
        n30++;
        s30 += e.amount;
      }
      if (e.daysUntil <= 60) {
        n60++;
        s60 += e.amount;
      }
      n90++;
      s90 += e.amount;
    }

    // Per-week buckets (13 weeks)
    const weeklyBuckets = Array.from({ length: 13 }, (_, i) => ({
      weekIndex: i,
      count: 0,
      estPerShare: 0,
    }));
    for (const e of upcoming) {
      const wk = Math.min(12, Math.floor(e.daysUntil / 7));
      const bucket = weeklyBuckets[wk]!;
      bucket.count++;
      bucket.estPerShare += e.amount;
    }

    // Top upcoming by amount
    const topUpcoming = [...upcoming].sort((a, b) => b.amount - a.amount).slice(0, 6);

    return {
      next30: { count: n30, estPerShare: s30 },
      next60: { count: n60, estPerShare: s60 },
      next90: { count: n90, estPerShare: s90 },
      topUpcoming,
      weeklyBuckets,
    };
  });
}

/** Leaderboards: top by various metrics. */
export interface Leaderboards {
  topYield: TickerCard[];
  topGrowth: TickerCard[]; // by 5y CAGR
  topStreak: TickerCard[]; // by growth streak
  topSafety: TickerCard[]; // by sustainability
}

export function buildLeaderboards(cards: TickerCard[], n = 5): Leaderboards {
  const byYield = [...cards]
    .filter((c) => c.forwardYield !== null && c.forwardYield > 0)
    .sort((a, b) => (b.forwardYield ?? 0) - (a.forwardYield ?? 0))
    .slice(0, n);
  const byGrowth = [...cards]
    .filter((c) => c.cagr5y !== null)
    .sort((a, b) => (b.cagr5y ?? Number.NEGATIVE_INFINITY) - (a.cagr5y ?? Number.NEGATIVE_INFINITY))
    .slice(0, n);
  const byStreak = [...cards]
    .filter((c) => c.kind === 'stock' && c.growthStreak > 0)
    .sort((a, b) => b.growthStreak - a.growthStreak)
    .slice(0, n);
  const bySafety = [...cards]
    .sort((a, b) => b.sustainability.total - a.sustainability.total)
    .slice(0, n);
  return {
    topYield: byYield,
    topGrowth: byGrowth,
    topStreak: byStreak,
    topSafety: bySafety,
  };
}

// === Yield-on-cost helper for charts ===

export function buildYocSeries(ticker: string, costBasisPerShare: number): YocPoint[] {
  const events = getDividendEvents(ticker);
  if (events.length === 0 || costBasisPerShare <= 0) return [];

  // Group dividends by year, compute trailing 12-month sum at each event,
  // then YOC = TTM / cost.
  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  const points: YocPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const asOf = sorted[i]!.exDate;
    const ttmDollars = ttmDividendPerShare(sorted.slice(0, i + 1), asOf);
    const yoc = ttmDollars / costBasisPerShare;
    if (yoc > 0) points.push({ date: asOf, yoc });
  }
  return points;
}
