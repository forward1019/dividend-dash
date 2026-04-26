-- dividend-dash schema
-- All money is stored as integer cents (USD by default).
-- All dates are ISO-8601 'YYYY-MM-DD' strings.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Securities master table. Bridges ticker, CUSIP, and SEC CIK.
CREATE TABLE IF NOT EXISTS securities (
  ticker        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  cusip         TEXT,
  cik           TEXT,                 -- SEC EDGAR Central Index Key (zero-padded 10 digits)
  sector        TEXT,
  industry      TEXT,
  exchange      TEXT,
  currency      TEXT NOT NULL DEFAULT 'USD',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_securities_cik ON securities(cik);
CREATE INDEX IF NOT EXISTS idx_securities_cusip ON securities(cusip);

-- Holdings: one row per (broker, account, ticker) pair.
-- Cost basis and shares are aggregate; lot detail lives in transactions.
CREATE TABLE IF NOT EXISTS holdings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  broker          TEXT NOT NULL,        -- 'fidelity' | 'robinhood' | 'ibkr' | 'manual' | '401k'
  account         TEXT NOT NULL,        -- masked account id e.g. '...1234'
  ticker          TEXT NOT NULL,
  shares          REAL NOT NULL,        -- fractional shares are common
  cost_basis_cents INTEGER NOT NULL,    -- total cost basis in cents
  as_of_date      TEXT NOT NULL,        -- when this snapshot was captured
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(broker, account, ticker, as_of_date),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON holdings(ticker);
CREATE INDEX IF NOT EXISTS idx_holdings_broker_account ON holdings(broker, account);

-- Transactions: every buy / sell / dividend received / split.
CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  broker          TEXT NOT NULL,
  account         TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  txn_type        TEXT NOT NULL CHECK(txn_type IN ('buy', 'sell', 'dividend', 'split', 'transfer_in', 'transfer_out', 'fee', 'other')),
  txn_date        TEXT NOT NULL,
  shares          REAL,
  price_cents     INTEGER,             -- per-share price in cents (buy/sell)
  amount_cents    INTEGER NOT NULL,    -- total cash impact in cents (positive = cash in)
  fees_cents      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  source_file     TEXT,                -- which CSV row this came from (for audit)
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

-- Dedup index: NULL-safe by COALESCEing shares to a sentinel.
-- A column-level UNIQUE wouldn't dedupe rows where shares IS NULL because
-- SQLite treats NULLs as distinct. This index handles dividend rows
-- (which have shares = NULL) correctly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_dedup ON transactions(
  broker, account, ticker, txn_type, txn_date, amount_cents, COALESCE(shares, -1)
);
CREATE INDEX IF NOT EXISTS idx_transactions_ticker_date ON transactions(ticker, txn_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(txn_type, txn_date);

-- Dividend events: per-share dividend declarations from yfinance / SEC EDGAR.
-- These are "what the security paid", independent of whether the user owned it.
CREATE TABLE IF NOT EXISTS dividend_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker          TEXT NOT NULL,
  ex_date         TEXT NOT NULL,
  pay_date        TEXT,
  record_date     TEXT,
  declared_date   TEXT,
  amount_per_share_cents INTEGER NOT NULL,  -- in cents (4 decimals: $0.4225 = 4225 millicents stored as 423? No — use micros)
  amount_per_share_micros INTEGER NOT NULL, -- per-share dividend in micro-dollars (1/1,000,000 USD) for precision
  frequency       TEXT,                     -- 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'special'
  source          TEXT NOT NULL,            -- 'yfinance' | 'sec_edgar' | 'polygon' | 'manual'
  raw             TEXT,                     -- JSON of raw source response
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(ticker, ex_date, source),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_dividend_events_ticker_date ON dividend_events(ticker, ex_date);

-- Daily prices (EOD only).
CREATE TABLE IF NOT EXISTS prices (
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,
  open_cents      INTEGER,
  high_cents      INTEGER,
  low_cents       INTEGER,
  close_cents     INTEGER NOT NULL,
  adj_close_cents INTEGER,
  volume          INTEGER,
  source          TEXT NOT NULL,
  PRIMARY KEY(ticker, date, source),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON prices(ticker, date);

-- Fundamentals snapshot (for sustainability scorecard).
CREATE TABLE IF NOT EXISTS fundamentals (
  ticker          TEXT NOT NULL,
  as_of_date      TEXT NOT NULL,
  fiscal_year     INTEGER,
  fiscal_quarter  INTEGER,
  eps_micros      INTEGER,                 -- TTM EPS in micros
  fcf_per_share_micros INTEGER,            -- TTM free cash flow per share in micros
  payout_ratio    REAL,                    -- dividends / earnings; null if loss
  fcf_payout_ratio REAL,                   -- dividends / FCF; null if FCF <= 0
  debt_to_equity  REAL,
  dividend_growth_streak_years INTEGER,    -- consecutive annual increases
  source          TEXT NOT NULL,
  PRIMARY KEY(ticker, as_of_date, source),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

-- Ingest log — every CSV import is recorded.
CREATE TABLE IF NOT EXISTS ingest_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  broker          TEXT NOT NULL,
  source_file     TEXT NOT NULL,
  source_sha256   TEXT NOT NULL,
  rows_total      INTEGER NOT NULL,
  rows_inserted   INTEGER NOT NULL,
  rows_skipped    INTEGER NOT NULL,
  rows_errored    INTEGER NOT NULL,
  errors_json     TEXT,
  ingested_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(broker, source_sha256)
);

-- Quote snapshot: rich market-data picture per ticker. One row per ticker
-- per fetch_date. Used by the v0.4 detail page to render a full
-- fundamentals panel (P/E, P/S, P/B, market cap, volume, beta, EPS, etc.)
-- alongside the existing dividend-focused stats. Numeric fields default
-- to native floats — yfinance returns them as floats and exact precision
-- is not required for display.
CREATE TABLE IF NOT EXISTS quote_snapshot (
  ticker             TEXT NOT NULL,
  fetch_date         TEXT NOT NULL,             -- ISO YYYY-MM-DD when we fetched
  short_name         TEXT,
  long_name          TEXT,
  exchange           TEXT,
  currency           TEXT,
  quote_type         TEXT,                      -- 'EQUITY' | 'ETF' | 'MUTUALFUND' | …
  sector             TEXT,
  industry           TEXT,
  summary            TEXT,                      -- assetProfile longBusinessSummary or fund summary
  website            TEXT,
  -- Market data
  price              REAL,                      -- regular market price (USD or `currency`)
  market_cap         REAL,
  volume             REAL,
  avg_volume_3m      REAL,
  beta               REAL,
  fifty_two_week_high REAL,
  fifty_two_week_low  REAL,
  fifty_two_week_change_pct REAL,
  -- Earnings + valuation
  eps_trailing       REAL,
  eps_forward        REAL,
  pe_trailing        REAL,
  pe_forward         REAL,
  ps_ratio           REAL,
  pb_ratio           REAL,
  peg_ratio          REAL,
  enterprise_value   REAL,
  ev_to_revenue      REAL,
  ev_to_ebitda       REAL,
  -- Cashflow + balance sheet
  free_cash_flow     REAL,
  operating_cash_flow REAL,
  total_debt         REAL,
  total_cash         REAL,
  return_on_equity   REAL,
  return_on_assets   REAL,
  profit_margins     REAL,
  -- Dividend (latest broker numbers, may differ from our computed series)
  dividend_rate      REAL,
  dividend_yield     REAL,                      -- 0..1 fraction
  payout_ratio       REAL,
  ex_dividend_date   TEXT,
  -- ETF specifics (top-level numbers; full holdings live in etf_holdings)
  expense_ratio      REAL,
  total_assets       REAL,
  fund_family        TEXT,
  inception_date     TEXT,
  ytd_return         REAL,
  three_year_return  REAL,
  five_year_return   REAL,
  raw_json           TEXT,                       -- raw quoteSummary modules for debugging
  fetched_at         TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(ticker, fetch_date),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_quote_snapshot_ticker ON quote_snapshot(ticker, fetch_date DESC);

-- ETF holdings: top N positions for an ETF as of a point in time. yfinance's
-- topHoldings module returns up to ~10. We additionally store sector/asset
-- breakdowns as JSON blobs since they're cheap and rarely queried.
CREATE TABLE IF NOT EXISTS etf_holdings (
  etf_ticker       TEXT NOT NULL,
  fetch_date       TEXT NOT NULL,
  position         INTEGER NOT NULL,            -- 1-based rank
  holding_symbol   TEXT,
  holding_name     TEXT NOT NULL,
  allocation_pct   REAL NOT NULL,               -- 0..1 fraction
  PRIMARY KEY(etf_ticker, fetch_date, position),
  FOREIGN KEY(etf_ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_etf_holdings_etf ON etf_holdings(etf_ticker, fetch_date DESC);

CREATE TABLE IF NOT EXISTS etf_profile (
  etf_ticker         TEXT NOT NULL,
  fetch_date         TEXT NOT NULL,
  total_holdings     INTEGER,                  -- nullable; yfinance doesn't always provide
  sector_weights_json TEXT,                    -- [{sector: "Technology", pct: 0.32}, …]
  asset_classes_json  TEXT,                    -- {stockPosition, bondPosition, cashPosition, …}
  bond_ratings_json   TEXT,
  bond_holdings_json  TEXT,
  raw_json            TEXT,
  PRIMARY KEY(etf_ticker, fetch_date),
  FOREIGN KEY(etf_ticker) REFERENCES securities(ticker)
);

-- Latest news per ticker. Items are deduped by (ticker, link) so re-fetching
-- doesn't grow the table linearly. We keep a fixed window — anything older
-- than ~90 days is auto-pruned at fetch time.
CREATE TABLE IF NOT EXISTS ticker_news (
  ticker         TEXT NOT NULL,
  link           TEXT NOT NULL,
  title          TEXT NOT NULL,
  publisher      TEXT,
  published_at   TEXT NOT NULL,                -- ISO 8601 with timezone
  summary        TEXT,
  thumbnail_url  TEXT,
  related_tickers TEXT,                        -- comma-separated; for cross-link
  fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(ticker, link),
  FOREIGN KEY(ticker) REFERENCES securities(ticker)
);

CREATE INDEX IF NOT EXISTS idx_ticker_news_ticker_date ON ticker_news(ticker, published_at DESC);

-- Schema version tracking (lightweight, not a full migrations framework).
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version(version) VALUES (1);
INSERT OR IGNORE INTO schema_version(version) VALUES (2);
