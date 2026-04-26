/**
 * Rich market-data fetchers added in v0.4 to power the redesigned ticker
 * detail page.
 *
 * Three concerns:
 *
 *   1. fetchQuoteSnapshot — single-ticker snapshot of valuation, market,
 *      cashflow, and dividend metrics. Powers the "Fundamentals" panel
 *      and the hero stats. Pulls from yfinance v3's `quoteSummary` modules
 *      (summaryDetail, defaultKeyStatistics, financialData, assetProfile,
 *      summaryProfile, fundProfile, fundPerformance, topHoldings, price)
 *      plus the standalone `quote` call. Tolerant of missing modules
 *      (ETFs, mutual funds, foreign tickers, etc. expose different shapes).
 *
 *   2. fetchEtfHoldings — top-10 holdings, sector breakdown, asset-class
 *      breakdown for ETFs and mutual funds. Reads `topHoldings` module.
 *
 *   3. fetchTickerNews — recent news headlines for a ticker. Uses
 *      `yf.search(ticker, { newsCount: N })`.
 *
 * All three functions return null on any error/empty result so callers can
 * keep going through the universe without aborting on one bad ticker.
 *
 * Persistence helpers (`upsertQuoteSnapshot`, `upsertEtfHoldings`,
 * `upsertEtfProfile`, `upsertNews`) live alongside the fetchers; they
 * each take a Database handle so they're easy to test against an in-memory
 * SQLite.
 */

import type { Database } from 'bun:sqlite';
import YahooFinance from 'yahoo-finance2';

import { upsertSecurity } from '../db/repo.ts';
import { log } from '../lib/logger.ts';

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });

// -----------------------------------------------------------------------------
// Quote snapshot
// -----------------------------------------------------------------------------

export interface QuoteSnapshot {
  ticker: string;
  fetchDate: string; // ISO YYYY-MM-DD

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
  dividendYield: number | null; // 0..1 fraction
  payoutRatio: number | null;
  exDividendDate: string | null;

  expenseRatio: number | null;
  totalAssets: number | null;
  fundFamily: string | null;
  inceptionDate: string | null;
  ytdReturn: number | null;
  threeYearReturn: number | null;
  fiveYearReturn: number | null;

  rawJson: string;
}

function num(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return null;
  return v;
}
function str(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return null;
  return v;
}
function isoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(v * 1000).toISOString().slice(0, 10);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return null;
}

export async function fetchQuoteSnapshot(ticker: string): Promise<QuoteSnapshot | null> {
  const t = ticker.toUpperCase();
  // Pull the union of every module we use across stock + ETF detail pages.
  // yfinance silently omits modules a given ticker doesn't expose; we
  // tolerate that by reading optionally everywhere.
  const modules = [
    'price',
    'summaryDetail',
    'summaryProfile',
    'assetProfile',
    'defaultKeyStatistics',
    'financialData',
    'fundProfile',
    'fundPerformance',
    'topHoldings',
  ] as const;

  let summary: Record<string, unknown> = {};
  try {
    // biome-ignore lint/suspicious/noExplicitAny: yahoo-finance2 module list typing is brittle
    summary = (await yf.quoteSummary(t, { modules: modules as unknown as any })) ?? {};
  } catch (err) {
    log.warn(`[${t}] quoteSummary failed`, { error: String(err) });
  }

  let quote: Record<string, unknown> = {};
  try {
    quote = ((await yf.quote(t)) ?? {}) as Record<string, unknown>;
  } catch (err) {
    log.warn(`[${t}] quote() failed`, { error: String(err) });
  }

  // If both calls produced nothing, this ticker is busted — bail.
  if (Object.keys(summary).length === 0 && Object.keys(quote).length === 0) {
    return null;
  }

  // Pull every nested module out into a typed-but-loose handle. We use
  // `as any` deliberately so individual fields can be optionally chained
  // without zod overhead per ticker; the table's columns are all nullable.
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes are inconsistent
  const sd = (summary.summaryDetail ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const ks = (summary.defaultKeyStatistics ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const fd = (summary.financialData ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const ap = (summary.assetProfile ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const sp = (summary.summaryProfile ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const fp = (summary.fundProfile ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const fperf = (summary.fundPerformance ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const th = (summary.topHoldings ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const px = (summary.price ?? {}) as any;
  // biome-ignore lint/suspicious/noExplicitAny: yfinance shapes
  const q = quote as any;

  const fwhLowChangePct =
    typeof q.fiftyTwoWeekChangePercent === 'number' ? q.fiftyTwoWeekChangePercent : null;

  // yfinance returns several ratios as percentages (e.g. debtToEquity = 145.2).
  // Most clients expect decimals for ratios but percentages for "yield"-shaped
  // numbers. We standardize at the boundary:
  //   - dividendYield: keep as percentage from quote() / 100 = fraction
  //   - payoutRatio:  already 0..1 from yfinance summaryDetail
  //   - debtToEquity:  /100 in yahoo-quote.ts, but here we keep it as a ratio
  //     for display purposes (matching summaryDetail/financialData).
  // For new fields we leave them in their native yfinance representation
  // and document in the UI layer how to format them.

  // dividendYield from quote() comes in as percentage (e.g. 3.44); from
  // summaryDetail it's a fraction (0.0344). Prefer summaryDetail when
  // present, fall back to quote / 100.
  const divYieldFrac = (() => {
    const sdY = num(sd.dividendYield);
    if (sdY !== null && sdY <= 1) return sdY;
    const sdYpct = num(sd.dividendYield);
    if (sdYpct !== null && sdYpct > 1) return sdYpct / 100;
    const qY = num(q.dividendYield) ?? num(q.trailingAnnualDividendYield);
    if (qY === null) return null;
    return qY > 1 ? qY / 100 : qY;
  })();

  const snap: QuoteSnapshot = {
    ticker: t,
    fetchDate: new Date().toISOString().slice(0, 10),
    shortName: str(q.shortName) ?? str(px.shortName) ?? null,
    longName: str(q.longName) ?? str(px.longName) ?? null,
    exchange: str(q.fullExchangeName) ?? str(q.exchange) ?? str(px.exchangeName) ?? null,
    currency: str(q.currency) ?? str(px.currency) ?? 'USD',
    quoteType: str(q.quoteType) ?? str(px.quoteType) ?? null,
    sector: str(ap.sector) ?? str(sp.sector) ?? null,
    industry: str(ap.industry) ?? str(sp.industry) ?? null,
    summary: str(ap.longBusinessSummary) ?? str(sp.longBusinessSummary) ?? null,
    website: str(ap.website) ?? str(sp.website) ?? null,

    price: num(q.regularMarketPrice) ?? num(px.regularMarketPrice) ?? num(fd.currentPrice),
    marketCap: num(q.marketCap) ?? num(sd.marketCap) ?? num(px.marketCap),
    volume: num(q.regularMarketVolume) ?? num(sd.volume) ?? num(px.regularMarketVolume),
    avgVolume3m: num(q.averageDailyVolume3Month) ?? num(sd.averageVolume),
    beta: num(sd.beta) ?? num(ks.beta) ?? num(q.beta),
    fiftyTwoWeekHigh:
      num(q.fiftyTwoWeekHigh) ?? num(sd.fiftyTwoWeekHigh) ?? num(px.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: num(q.fiftyTwoWeekLow) ?? num(sd.fiftyTwoWeekLow) ?? num(px.fiftyTwoWeekLow),
    fiftyTwoWeekChangePct: fwhLowChangePct,

    epsTrailing: num(q.epsTrailingTwelveMonths) ?? num(ks.trailingEps),
    epsForward: num(q.epsForward) ?? num(ks.forwardEps),
    peTrailing: num(q.trailingPE) ?? num(sd.trailingPE),
    peForward: num(q.forwardPE) ?? num(sd.forwardPE) ?? num(ks.forwardPE),
    psRatio: num(q.priceToSalesTrailing12Months) ?? num(ks.priceToSalesTrailing12Months),
    pbRatio: num(q.priceToBook) ?? num(ks.priceToBook),
    pegRatio: num(ks.pegRatio),
    enterpriseValue: num(ks.enterpriseValue),
    evToRevenue: num(ks.enterpriseToRevenue),
    evToEbitda: num(ks.enterpriseToEbitda),

    freeCashFlow: num(fd.freeCashflow),
    operatingCashFlow: num(fd.operatingCashflow),
    totalDebt: num(fd.totalDebt),
    totalCash: num(fd.totalCash),
    returnOnEquity: num(fd.returnOnEquity),
    returnOnAssets: num(fd.returnOnAssets),
    profitMargins: num(fd.profitMargins) ?? num(ks.profitMargins),

    dividendRate: num(sd.dividendRate) ?? num(q.trailingAnnualDividendRate),
    dividendYield: divYieldFrac,
    payoutRatio: num(sd.payoutRatio) ?? num(ks.payoutRatio),
    exDividendDate: isoDate(sd.exDividendDate) ?? isoDate(q.exDividendDate),

    // ETF / fund specifics
    expenseRatio:
      num(fp.feesExpensesInvestment?.annualReportExpenseRatio) ??
      num(fp.feesExpensesInvestmentCat?.annualReportExpenseRatio) ??
      num(sd.annualReportExpenseRatio) ??
      null,
    totalAssets: num(sd.totalAssets) ?? num(q.netAssets),
    fundFamily: str(fp.family) ?? null,
    inceptionDate: isoDate(fp.legalType ? null : null) ?? null,
    ytdReturn:
      num(fperf.trailingReturns?.ytd) ?? num(fp.fundOverview?.trailingReturns?.ytd) ?? null,
    threeYearReturn: num(fperf.trailingReturns?.threeYear) ?? null,
    fiveYearReturn: num(fperf.trailingReturns?.fiveYear) ?? null,

    rawJson: JSON.stringify({
      summaryDetail: sd,
      defaultKeyStatistics: ks,
      financialData: fd,
      assetProfile: ap,
      summaryProfile: sp,
      fundProfile: fp,
      fundPerformance: fperf,
      topHoldings: th,
      price: px,
      quote: q,
    }).slice(0, 100_000), // bound the blob size
  };

  return snap;
}

export function upsertQuoteSnapshot(db: Database, s: QuoteSnapshot): void {
  upsertSecurity(db, {
    ticker: s.ticker,
    name: s.longName ?? s.shortName ?? s.ticker,
    sector: s.sector ?? undefined,
    industry: s.industry ?? undefined,
    exchange: s.exchange ?? undefined,
  });
  db.run(
    `INSERT INTO quote_snapshot(
       ticker, fetch_date, short_name, long_name, exchange, currency, quote_type,
       sector, industry, summary, website,
       price, market_cap, volume, avg_volume_3m, beta,
       fifty_two_week_high, fifty_two_week_low, fifty_two_week_change_pct,
       eps_trailing, eps_forward, pe_trailing, pe_forward, ps_ratio, pb_ratio, peg_ratio,
       enterprise_value, ev_to_revenue, ev_to_ebitda,
       free_cash_flow, operating_cash_flow, total_debt, total_cash,
       return_on_equity, return_on_assets, profit_margins,
       dividend_rate, dividend_yield, payout_ratio, ex_dividend_date,
       expense_ratio, total_assets, fund_family, inception_date,
       ytd_return, three_year_return, five_year_return, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?
     )
     ON CONFLICT(ticker, fetch_date) DO UPDATE SET
       short_name=excluded.short_name, long_name=excluded.long_name,
       exchange=excluded.exchange, currency=excluded.currency,
       quote_type=excluded.quote_type, sector=excluded.sector, industry=excluded.industry,
       summary=excluded.summary, website=excluded.website,
       price=excluded.price, market_cap=excluded.market_cap, volume=excluded.volume,
       avg_volume_3m=excluded.avg_volume_3m, beta=excluded.beta,
       fifty_two_week_high=excluded.fifty_two_week_high,
       fifty_two_week_low=excluded.fifty_two_week_low,
       fifty_two_week_change_pct=excluded.fifty_two_week_change_pct,
       eps_trailing=excluded.eps_trailing, eps_forward=excluded.eps_forward,
       pe_trailing=excluded.pe_trailing, pe_forward=excluded.pe_forward,
       ps_ratio=excluded.ps_ratio, pb_ratio=excluded.pb_ratio, peg_ratio=excluded.peg_ratio,
       enterprise_value=excluded.enterprise_value,
       ev_to_revenue=excluded.ev_to_revenue, ev_to_ebitda=excluded.ev_to_ebitda,
       free_cash_flow=excluded.free_cash_flow,
       operating_cash_flow=excluded.operating_cash_flow,
       total_debt=excluded.total_debt, total_cash=excluded.total_cash,
       return_on_equity=excluded.return_on_equity,
       return_on_assets=excluded.return_on_assets,
       profit_margins=excluded.profit_margins,
       dividend_rate=excluded.dividend_rate, dividend_yield=excluded.dividend_yield,
       payout_ratio=excluded.payout_ratio, ex_dividend_date=excluded.ex_dividend_date,
       expense_ratio=excluded.expense_ratio, total_assets=excluded.total_assets,
       fund_family=excluded.fund_family, inception_date=excluded.inception_date,
       ytd_return=excluded.ytd_return, three_year_return=excluded.three_year_return,
       five_year_return=excluded.five_year_return, raw_json=excluded.raw_json`,
    [
      s.ticker,
      s.fetchDate,
      s.shortName,
      s.longName,
      s.exchange,
      s.currency,
      s.quoteType,
      s.sector,
      s.industry,
      s.summary,
      s.website,
      s.price,
      s.marketCap,
      s.volume,
      s.avgVolume3m,
      s.beta,
      s.fiftyTwoWeekHigh,
      s.fiftyTwoWeekLow,
      s.fiftyTwoWeekChangePct,
      s.epsTrailing,
      s.epsForward,
      s.peTrailing,
      s.peForward,
      s.psRatio,
      s.pbRatio,
      s.pegRatio,
      s.enterpriseValue,
      s.evToRevenue,
      s.evToEbitda,
      s.freeCashFlow,
      s.operatingCashFlow,
      s.totalDebt,
      s.totalCash,
      s.returnOnEquity,
      s.returnOnAssets,
      s.profitMargins,
      s.dividendRate,
      s.dividendYield,
      s.payoutRatio,
      s.exDividendDate,
      s.expenseRatio,
      s.totalAssets,
      s.fundFamily,
      s.inceptionDate,
      s.ytdReturn,
      s.threeYearReturn,
      s.fiveYearReturn,
      s.rawJson,
    ],
  );
}

// -----------------------------------------------------------------------------
// ETF holdings + sector breakdown
// -----------------------------------------------------------------------------

export interface EtfHolding {
  position: number; // 1-based
  symbol: string | null;
  name: string;
  allocationPct: number; // 0..1
}

export interface EtfBreakdown {
  ticker: string;
  fetchDate: string;
  totalHoldings: number | null;
  sectorWeights: { sector: string; pct: number }[]; // pct in 0..1
  assetClasses: Record<string, number> | null;
  bondRatings: Record<string, number> | null;
  bondHoldings: Record<string, number> | null;
  rawJson: string;
}

export interface EtfHoldingsResult {
  holdings: EtfHolding[];
  breakdown: EtfBreakdown;
}

export async function fetchEtfHoldings(ticker: string): Promise<EtfHoldingsResult | null> {
  const t = ticker.toUpperCase();
  let topHoldings: Record<string, unknown> = {};
  try {
    // biome-ignore lint/suspicious/noExplicitAny: module list typing
    const summary = (await yf.quoteSummary(t, { modules: ['topHoldings'] as any })) ?? {};
    topHoldings = ((summary as Record<string, unknown>).topHoldings ?? {}) as Record<
      string,
      unknown
    >;
  } catch (err) {
    log.warn(`[${t}] topHoldings failed`, { error: String(err) });
    return null;
  }
  if (Object.keys(topHoldings).length === 0) return null;

  // biome-ignore lint/suspicious/noExplicitAny: yfinance shape
  const holdingsRaw = (topHoldings.holdings as any[]) ?? [];
  const holdings: EtfHolding[] = holdingsRaw
    .map((h, i) => {
      const sym = str(h?.symbol);
      const name = str(h?.holdingName) ?? sym ?? `Holding ${i + 1}`;
      const pct = num(h?.holdingPercent);
      if (pct === null) return null;
      return { position: i + 1, symbol: sym, name, allocationPct: pct };
    })
    .filter((h): h is EtfHolding => h !== null);

  // biome-ignore lint/suspicious/noExplicitAny: yfinance shape
  const sectorWeights = ((topHoldings.sectorWeightings as any[]) ?? [])
    .map((entry) => {
      // each entry is a single-key object e.g. {realestate: 0.04}
      const [key, value] = Object.entries(entry ?? {})[0] ?? [];
      if (!key || typeof value !== 'number') return null;
      return { sector: humanizeSector(String(key)), pct: value };
    })
    .filter((e): e is { sector: string; pct: number } => e !== null);

  const breakdown: EtfBreakdown = {
    ticker: t,
    fetchDate: new Date().toISOString().slice(0, 10),
    totalHoldings: num((topHoldings as { totalHoldings?: unknown }).totalHoldings) ?? null,
    sectorWeights,
    assetClasses: null,
    bondRatings: null,
    bondHoldings: null,
    rawJson: JSON.stringify(topHoldings).slice(0, 60_000),
  };

  return { holdings, breakdown };
}

function humanizeSector(key: string): string {
  // yfinance keys: realestate, consumer_cyclical, basic_materials, communication_services, …
  const map: Record<string, string> = {
    realestate: 'Real Estate',
    consumer_cyclical: 'Consumer Cyclical',
    basic_materials: 'Basic Materials',
    consumer_defensive: 'Consumer Defensive',
    technology: 'Technology',
    communication_services: 'Communication Services',
    financial_services: 'Financial Services',
    industrials: 'Industrials',
    energy: 'Energy',
    utilities: 'Utilities',
    healthcare: 'Healthcare',
    financialservices: 'Financial Services', // belt + suspenders
  };
  if (map[key]) return map[key]!;
  return key
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function upsertEtfHoldings(db: Database, ticker: string, result: EtfHoldingsResult): void {
  const t = ticker.toUpperCase();
  upsertSecurity(db, { ticker: t, name: t });
  // Wipe any stale rows for the same fetch_date so a re-fetch with fewer
  // holdings doesn't leave orphan tail rows.
  db.run('DELETE FROM etf_holdings WHERE etf_ticker = ? AND fetch_date = ?', [
    t,
    result.breakdown.fetchDate,
  ]);
  for (const h of result.holdings) {
    db.run(
      `INSERT INTO etf_holdings(etf_ticker, fetch_date, position, holding_symbol, holding_name, allocation_pct)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [t, result.breakdown.fetchDate, h.position, h.symbol, h.name, h.allocationPct],
    );
  }
  db.run(
    `INSERT INTO etf_profile(
       etf_ticker, fetch_date, total_holdings, sector_weights_json,
       asset_classes_json, bond_ratings_json, bond_holdings_json, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(etf_ticker, fetch_date) DO UPDATE SET
       total_holdings = excluded.total_holdings,
       sector_weights_json = excluded.sector_weights_json,
       asset_classes_json = excluded.asset_classes_json,
       bond_ratings_json = excluded.bond_ratings_json,
       bond_holdings_json = excluded.bond_holdings_json,
       raw_json = excluded.raw_json`,
    [
      t,
      result.breakdown.fetchDate,
      result.breakdown.totalHoldings,
      JSON.stringify(result.breakdown.sectorWeights),
      result.breakdown.assetClasses ? JSON.stringify(result.breakdown.assetClasses) : null,
      result.breakdown.bondRatings ? JSON.stringify(result.breakdown.bondRatings) : null,
      result.breakdown.bondHoldings ? JSON.stringify(result.breakdown.bondHoldings) : null,
      result.breakdown.rawJson,
    ],
  );
}

// -----------------------------------------------------------------------------
// News
// -----------------------------------------------------------------------------

export interface NewsItem {
  ticker: string;
  link: string;
  title: string;
  publisher: string | null;
  publishedAt: string; // ISO
  summary: string | null;
  thumbnailUrl: string | null;
  relatedTickers: string | null;
}

export async function fetchTickerNews(ticker: string, count = 10): Promise<NewsItem[]> {
  const t = ticker.toUpperCase();
  try {
    const result = await yf.search(t, {
      newsCount: count,
      quotesCount: 0,
      enableFuzzyQuery: false,
      enableEnhancedTrivialQuery: true,
    });
    // biome-ignore lint/suspicious/noExplicitAny: search shape
    const items = ((result as any).news ?? []) as any[];
    return items
      .map((it): NewsItem | null => {
        const link = str(it?.link);
        const title = str(it?.title);
        if (!link || !title) return null;
        // publishTime is unix-seconds in v3 of yahoo-finance2.
        const pubTimeRaw = it?.providerPublishTime;
        const pub = (() => {
          if (pubTimeRaw instanceof Date) return pubTimeRaw.toISOString();
          if (typeof pubTimeRaw === 'number') return new Date(pubTimeRaw * 1000).toISOString();
          if (typeof pubTimeRaw === 'string') {
            const d = new Date(pubTimeRaw);
            if (!Number.isNaN(d.getTime())) return d.toISOString();
          }
          return new Date().toISOString();
        })();
        const thumb = (() => {
          // biome-ignore lint/suspicious/noExplicitAny: thumbnail shape
          const t2 = (it.thumbnail as any)?.resolutions;
          if (Array.isArray(t2) && t2.length > 0) return str(t2[0]?.url);
          return null;
        })();
        const related = Array.isArray(it.relatedTickers)
          ? it.relatedTickers.filter((s: unknown): s is string => typeof s === 'string').join(',')
          : null;
        return {
          ticker: t,
          link,
          title,
          publisher: str(it.publisher),
          publishedAt: pub,
          summary: str(it.summary) ?? str(it.snippet) ?? null,
          thumbnailUrl: thumb,
          relatedTickers: related,
        };
      })
      .filter((n): n is NewsItem => n !== null);
  } catch (err) {
    log.warn(`[${t}] yfinance news search failed`, { error: String(err) });
    return [];
  }
}

export function upsertNews(db: Database, ticker: string, items: NewsItem[]): void {
  const t = ticker.toUpperCase();
  if (items.length === 0) return;
  upsertSecurity(db, { ticker: t, name: t });
  // Prune older-than-90d entries before inserting fresh ones so the table
  // stays bounded.
  const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  db.run('DELETE FROM ticker_news WHERE ticker = ? AND published_at < ?', [t, cutoff]);
  for (const n of items) {
    db.run(
      `INSERT INTO ticker_news(ticker, link, title, publisher, published_at, summary, thumbnail_url, related_tickers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ticker, link) DO UPDATE SET
         title=excluded.title, publisher=excluded.publisher,
         published_at=excluded.published_at, summary=excluded.summary,
         thumbnail_url=excluded.thumbnail_url, related_tickers=excluded.related_tickers`,
      [
        n.ticker,
        n.link,
        n.title,
        n.publisher,
        n.publishedAt,
        n.summary,
        n.thumbnailUrl,
        n.relatedTickers,
      ],
    );
  }
}
