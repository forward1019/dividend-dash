/**
 * Dividend universe — 20 popular dividend ETFs + 20 popular individual
 * dividend stocks. These are the tickers the web dashboard tracks even
 * if the user has no holdings yet.
 *
 * Categories are surfaced in the UI for filtering. `notes` is a short
 * editorial line shown as a tooltip / badge in the dashboard.
 */

export type UniverseCategory =
  | 'core_etf' // broad-market dividend ETFs (SCHD, VYM, etc.)
  | 'growth_etf' // dividend growth focused ETFs (VIG, DGRO, NOBL)
  | 'high_yield_etf' // high-yield ETFs (SPYD, HDV, DIV, FDVV)
  | 'income_etf' // covered-call / specialty income (JEPI, JEPQ, QYLD)
  | 'international_etf' // international dividend ETFs (IDV, SDIV, REET)
  | 'aristocrat' // S&P 500 Dividend Aristocrats (25+ years)
  | 'king' // Dividend Kings (50+ years)
  | 'income_stock' // high-yield individual stocks
  | 'reit' // REITs
  | 'mlp_other'; // MLPs, BDCs, etc.

export interface UniverseTicker {
  ticker: string;
  name: string;
  category: UniverseCategory;
  kind: 'etf' | 'stock';
  notes?: string;
}

/**
 * Curated list of 40 of the most-watched dividend tickers as of 2026.
 * Ordered by category then ticker.
 */
export const DIVIDEND_UNIVERSE: UniverseTicker[] = [
  // === Core dividend ETFs ===
  {
    ticker: 'SCHD',
    name: 'Schwab U.S. Dividend Equity ETF',
    category: 'core_etf',
    kind: 'etf',
    notes: 'Quality dividend payers, screens for 10y dividend history',
  },
  {
    ticker: 'VYM',
    name: 'Vanguard High Dividend Yield ETF',
    category: 'core_etf',
    kind: 'etf',
    notes: 'Broad high-yield index, ~440 holdings',
  },
  {
    ticker: 'DVY',
    name: 'iShares Select Dividend ETF',
    category: 'core_etf',
    kind: 'etf',
    notes: '5-year dividend payment history screen',
  },

  // === Dividend growth ETFs ===
  {
    ticker: 'VIG',
    name: 'Vanguard Dividend Appreciation ETF',
    category: 'growth_etf',
    kind: 'etf',
    notes: '10y consecutive dividend growth screen',
  },
  {
    ticker: 'DGRO',
    name: 'iShares Core Dividend Growth ETF',
    category: 'growth_etf',
    kind: 'etf',
    notes: '5y growth + healthy payout screen',
  },
  {
    ticker: 'NOBL',
    name: 'ProShares S&P 500 Dividend Aristocrats ETF',
    category: 'growth_etf',
    kind: 'etf',
    notes: '25+ years of consecutive dividend growth',
  },
  {
    ticker: 'SDY',
    name: 'SPDR S&P Dividend ETF',
    category: 'growth_etf',
    kind: 'etf',
    notes: '20+ years of consecutive growth (S&P Composite 1500)',
  },

  // === High-yield ETFs ===
  {
    ticker: 'SPYD',
    name: 'SPDR Portfolio S&P 500 High Dividend ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'Top 80 yielders in S&P 500, equal-weighted',
  },
  {
    ticker: 'HDV',
    name: 'iShares Core High Dividend ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'High-quality high-yielders, Morningstar moat screen',
  },
  {
    ticker: 'FDVV',
    name: 'Fidelity High Dividend ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'Yield + payout sustainability factor screen',
  },

  // === Income / covered-call ETFs ===
  {
    ticker: 'JEPI',
    name: 'JPMorgan Equity Premium Income ETF',
    category: 'income_etf',
    kind: 'etf',
    notes: 'Active equity + ELN-based covered call income',
  },
  {
    ticker: 'JEPQ',
    name: 'JPMorgan Nasdaq Equity Premium Income ETF',
    category: 'income_etf',
    kind: 'etf',
    notes: 'Nasdaq tilt with ELN covered call sleeve',
  },
  {
    ticker: 'QYLD',
    name: 'Global X NASDAQ 100 Covered Call ETF',
    category: 'income_etf',
    kind: 'etf',
    notes: 'Covered calls on NDX, monthly distributions',
  },

  // === International dividend ETFs ===
  {
    ticker: 'IDV',
    name: 'iShares International Select Dividend ETF',
    category: 'international_etf',
    kind: 'etf',
    notes: 'Developed-markets ex-US, dividend screen',
  },
  {
    ticker: 'VYMI',
    name: 'Vanguard International High Dividend Yield ETF',
    category: 'international_etf',
    kind: 'etf',
    notes: 'International high-yield broad index',
  },
  {
    ticker: 'REET',
    name: 'iShares Global REIT ETF',
    category: 'international_etf',
    kind: 'etf',
    notes: 'Global REIT exposure (US + international)',
  },

  // === Specialty / preferred ===
  {
    ticker: 'PFF',
    name: 'iShares Preferred and Income Securities ETF',
    category: 'income_etf',
    kind: 'etf',
    notes: 'US preferred stock, monthly distributions',
  },
  {
    ticker: 'SDIV',
    name: 'Global X SuperDividend ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'Top 100 highest-yielding equities globally',
  },
  {
    ticker: 'DIV',
    name: 'Global X SuperDividend U.S. ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'Top 50 highest-yielding US equities',
  },
  {
    ticker: 'RDIV',
    name: 'Invesco S&P Ultra Dividend Revenue ETF',
    category: 'high_yield_etf',
    kind: 'etf',
    notes: 'Revenue-weighted high-yield, S&P 900 universe',
  },

  // === Dividend Kings (50+ years) ===
  {
    ticker: 'KO',
    name: 'The Coca-Cola Company',
    category: 'king',
    kind: 'stock',
    notes: 'Dividend King: 60+ years of consecutive raises',
  },
  {
    ticker: 'JNJ',
    name: 'Johnson & Johnson',
    category: 'king',
    kind: 'stock',
    notes: 'Dividend King: 60+ years of consecutive raises',
  },
  {
    ticker: 'PG',
    name: 'The Procter & Gamble Company',
    category: 'king',
    kind: 'stock',
    notes: 'Dividend King: 65+ years of consecutive raises',
  },
  {
    ticker: 'MMM',
    name: '3M Company',
    category: 'king',
    kind: 'stock',
    notes: 'Dividend King: 65+ years; payout under stress',
  },
  {
    ticker: 'EMR',
    name: 'Emerson Electric Co.',
    category: 'king',
    kind: 'stock',
    notes: 'Dividend King: 65+ years',
  },

  // === Aristocrats (25+ years) ===
  {
    ticker: 'PEP',
    name: 'PepsiCo, Inc.',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Aristocrat: 50+ years of raises',
  },
  {
    ticker: 'MCD',
    name: "McDonald's Corporation",
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Aristocrat: ~45 years of raises',
  },
  {
    ticker: 'WMT',
    name: 'Walmart Inc.',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Aristocrat: 50+ years',
  },
  {
    ticker: 'ABBV',
    name: 'AbbVie Inc.',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Aristocrat (incl. Abbott legacy)',
  },
  {
    ticker: 'CVX',
    name: 'Chevron Corporation',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Energy aristocrat: 35+ years',
  },
  {
    ticker: 'XOM',
    name: 'Exxon Mobil Corporation',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Energy aristocrat: 40+ years',
  },
  {
    ticker: 'LMT',
    name: 'Lockheed Martin Corporation',
    category: 'aristocrat',
    kind: 'stock',
    notes: 'Defense, ~22y growth streak',
  },

  // === High-yield individual stocks ===
  {
    ticker: 'MO',
    name: 'Altria Group, Inc.',
    category: 'income_stock',
    kind: 'stock',
    notes: 'Tobacco; high yield, secular decline risk',
  },
  {
    ticker: 'T',
    name: 'AT&T Inc.',
    category: 'income_stock',
    kind: 'stock',
    notes: '2022 dividend cut after WBD spin; rebuilding',
  },
  {
    ticker: 'VZ',
    name: 'Verizon Communications Inc.',
    category: 'income_stock',
    kind: 'stock',
    notes: 'Telco income; payout ratio elevated',
  },
  {
    ticker: 'PFE',
    name: 'Pfizer Inc.',
    category: 'income_stock',
    kind: 'stock',
    notes: 'Pharma, Covid revenue normalization',
  },

  // === REITs ===
  {
    ticker: 'O',
    name: 'Realty Income Corporation',
    category: 'reit',
    kind: 'stock',
    notes: '"The Monthly Dividend Company"; 30+ years of growth',
  },
  {
    ticker: 'VICI',
    name: 'VICI Properties Inc.',
    category: 'reit',
    kind: 'stock',
    notes: 'Gaming/experiential REIT',
  },
  {
    ticker: 'STAG',
    name: 'STAG Industrial, Inc.',
    category: 'reit',
    kind: 'stock',
    notes: 'Industrial REIT, monthly payer',
  },
  {
    ticker: 'MAIN',
    name: 'Main Street Capital Corporation',
    category: 'mlp_other',
    kind: 'stock',
    notes: 'BDC, monthly + supplemental dividends',
  },
];

export function getTicker(symbol: string): UniverseTicker | undefined {
  const s = symbol.toUpperCase();
  return DIVIDEND_UNIVERSE.find((t) => t.ticker === s);
}

export const CATEGORY_LABELS: Record<UniverseCategory, string> = {
  core_etf: 'Core dividend ETFs',
  growth_etf: 'Dividend growth ETFs',
  high_yield_etf: 'High-yield ETFs',
  income_etf: 'Income / covered-call ETFs',
  international_etf: 'International ETFs',
  aristocrat: 'Dividend Aristocrats',
  king: 'Dividend Kings',
  income_stock: 'High-yield stocks',
  reit: 'REITs',
  mlp_other: 'BDCs / MLPs',
};
