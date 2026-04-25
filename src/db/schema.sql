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

-- Schema version tracking (lightweight, not a full migrations framework).
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schema_version(version) VALUES (1);
