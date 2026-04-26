/**
 * Per-ticker drill-down view (rebuilt for v0.4).
 *
 * Layout (top → bottom):
 *
 *   1. Hero
 *      - Symbol, name, exchange / sector / industry tag row
 *      - Big price · forward yield · safety score (existing)
 *      - 52-week range bar with current marker (new)
 *
 *   2. Quick stat grid (existing 12-cell, kept for dividend continuity)
 *
 *   3. Charts: annualized DPS · sustainability scorecard (existing)
 *
 *   4. Fundamentals panel (NEW v0.4)
 *      - 12 "metric cards" — P/E (trail+fwd), P/S, P/B, PEG, market cap,
 *        beta, EPS, FCF, debt/cash, ROE, profit margin, ex-div date.
 *      - Adapts to ETF: shows AUM, expense ratio, fund family, 1y/3y/5y
 *        return instead of revenue/cashflow which yfinance doesn't fill.
 *
 *   5. ETF holdings (NEW v0.4 — ETF-only)
 *      - Top-10 holdings as horizontal bar list with allocation %
 *      - Sector breakdown (donut)
 *
 *   6. Per-payment + Recent payments table (existing)
 *
 *   7. TTM cumulative chart (existing)
 *
 *   8. Latest news (NEW v0.4)
 *      - Up to 8 items, deduped, ordered by published_at desc
 *      - Freshness dot (red <1h, amber <6h, gray older)
 *
 *   9. Company / fund summary (NEW v0.4) — final paragraph from
 *      assetProfile.longBusinessSummary, collapsed by default.
 */

import type {
  DividendHistoryPoint,
  EtfHoldingRow,
  EtfProfileRow,
  NewsRow,
  QuoteSnapshotRow,
  TickerCard,
} from '../data.ts';
import { getTicker } from '../tickers.ts';
import {
  escapeHtml,
  fmtNum,
  fmtPct,
  fmtUsd,
  renderLayout,
  scoreColor,
  yieldColor,
} from './layout.ts';

interface TickerPageData {
  card: TickerCard;
  history: DividendHistoryPoint[];
  cagr1y: number | null;
  cagr3y: number | null;
  /** Optional rich snapshot — present when seed-universe v0.4+ has run. */
  snapshot: QuoteSnapshotRow | null;
  /** ETF-only — empty for stocks. */
  holdings: EtfHoldingRow[];
  etfProfile: EtfProfileRow | null;
  news: NewsRow[];
}

const SECTOR_COLORS = [
  '#34d399', // emerald
  '#22d3ee', // cyan
  '#a78bfa', // violet
  '#fbbf24', // amber
  '#fb7185', // rose
  '#60a5fa', // blue
  '#f472b6', // pink
  '#a3e635', // lime
  '#fb923c', // orange
  '#94a3b8', // slate
  '#facc15', // yellow
  '#10b981',
];

export function renderTickerPage(data: TickerPageData): string {
  const c = data.card;
  const h = data.history;
  const snap = data.snapshot;

  // === Derived chart data (unchanged from v0.3) ===
  const cumulative = computeTtmSeries(h);
  const annualMap = new Map<number, number>();
  for (const p of h) {
    const yr = Number.parseInt(p.exDate.slice(0, 4), 10);
    annualMap.set(yr, (annualMap.get(yr) ?? 0) + p.amount);
  }
  const annualSeries = Array.from(annualMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, total]) => ({ year, total }));

  const lastFive = [...h].slice(-12).reverse();

  const sustComp = c.sustainability.components;
  const sustItems = [
    { name: 'Payout ratio', score: sustComp.payout.score, weight: sustComp.payout.weight },
    { name: 'FCF cover', score: sustComp.fcfCover.score, weight: sustComp.fcfCover.weight },
    {
      name: 'Growth streak',
      score: sustComp.growthStreak.score,
      weight: sustComp.growthStreak.weight,
    },
    { name: 'Debt/equity', score: sustComp.debtEquity.score, weight: sustComp.debtEquity.weight },
  ];

  // === Embed chart payloads in <head> for the bottom-of-page <script>. ===
  const sectorWeights = data.etfProfile?.sectorWeights ?? [];
  const head = `<script>
    window.__TICKER__ = ${JSON.stringify({
      ticker: c.ticker,
      history: h,
      cumulative,
      annualSeries,
      sectorWeights,
    })};
  </script>`;

  const isEtf = c.kind === 'etf';

  const fmtBig = (n: number | null | undefined): string => {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  };
  const fmtVol = (n: number | null | undefined): string => {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return n.toFixed(0);
  };
  const fmtRatio = (n: number | null | undefined, decimals = 2): string => {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return n.toFixed(decimals);
  };

  // === Build 52-week range bar ===
  const fiftyTwoWeekHi = snap?.fiftyTwoWeekHigh ?? null;
  const fiftyTwoWeekLo = snap?.fiftyTwoWeekLow ?? null;
  const currPrice = snap?.price ?? (c.priceCents !== null ? c.priceCents / 100 : null);
  const fiftyTwoBar = (() => {
    if (fiftyTwoWeekHi === null || fiftyTwoWeekLo === null || currPrice === null) return '';
    if (fiftyTwoWeekHi <= fiftyTwoWeekLo) return '';
    const pos = ((currPrice - fiftyTwoWeekLo) / (fiftyTwoWeekHi - fiftyTwoWeekLo)) * 100;
    const clamped = Math.max(0, Math.min(100, pos));
    return /* html */ `
      <div class="mt-3">
        <div class="flex items-center justify-between text-[11px] text-slate-500 mb-1">
          <span class="num">$${fiftyTwoWeekLo.toFixed(2)} <span class="text-slate-600">52w low</span></span>
          <span class="num">$${fiftyTwoWeekHi.toFixed(2)} <span class="text-slate-600">52w high</span></span>
        </div>
        <div class="relative h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
          <div class="absolute inset-y-0 left-0 right-0 bg-gradient-to-r from-rose-500/30 via-amber-400/30 to-emerald-400/30 rounded-full"></div>
          <div class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-emerald-400 border-2 border-slate-950 shadow-lg shadow-emerald-500/40" style="left:${clamped.toFixed(1)}%"></div>
        </div>
      </div>
    `;
  })();

  // === Hero subtitle: exchange · sector · industry · category ===
  const subtitleParts: string[] = [];
  if (snap?.exchange) subtitleParts.push(escapeHtml(snap.exchange));
  if (snap?.sector) subtitleParts.push(escapeHtml(snap.sector));
  if (snap?.industry) subtitleParts.push(escapeHtml(snap.industry));
  if (subtitleParts.length === 0 && snap?.fundFamily)
    subtitleParts.push(escapeHtml(snap.fundFamily));
  const subtitleHtml = subtitleParts.join(' <span class="text-slate-700">·</span> ');

  // === Build fundamentals card list (split into stock vs ETF) ===
  const fundamentalsCards = isEtf
    ? buildEtfFundamentalsCards(snap)
    : buildStockFundamentalsCards(snap);

  // === ETF holdings rendering ===
  const holdingsHtml = isEtf ? renderEtfHoldings(data.holdings, data.etfProfile) : '';

  // === News rendering ===
  const newsHtml = renderNewsList(data.news);

  // === Company / fund summary (collapsed) ===
  const summaryHtml = snap?.summary ? renderSummary(snap.summary, snap.website ?? null) : '';

  const body = /* html */ `
  <div class="space-y-6">
    <!-- Breadcrumb -->
    <nav class="text-xs text-slate-500 flex items-center gap-1.5">
      <a href="/" class="hover:text-emerald-400">Dashboard</a>
      <span>/</span>
      <span class="text-slate-300">${escapeHtml(c.ticker)}</span>
    </nav>

    <!-- Hero -->
    <section class="glass-strong rounded-2xl p-6">
      <div class="flex flex-wrap items-start justify-between gap-6">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-3 flex-wrap">
            <h1 class="font-bold text-3xl font-mono tracking-tight">${escapeHtml(c.ticker)}</h1>
            ${
              c.kind === 'etf'
                ? '<span class="text-xs px-2 py-1 rounded bg-cyan-500/15 text-cyan-300 font-mono">ETF</span>'
                : '<span class="text-xs px-2 py-1 rounded bg-violet-500/15 text-violet-300 font-mono">STOCK</span>'
            }
            <span class="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300">${escapeHtml(c.categoryLabel)}</span>
          </div>
          <p class="text-slate-200 mt-1.5 text-base font-medium">${escapeHtml(c.name)}</p>
          ${subtitleHtml ? `<p class="text-xs text-slate-500 mt-1">${subtitleHtml}</p>` : ''}
          ${c.notes ? `<p class="text-sm text-slate-500 mt-1.5 italic">${escapeHtml(c.notes)}</p>` : ''}
          ${fiftyTwoBar}
        </div>
        <div class="flex items-center gap-6 flex-wrap">
          <div class="text-right">
            <div class="text-[10px] uppercase tracking-wider text-slate-500">Price</div>
            <div class="num font-bold text-2xl text-slate-100">${fmtUsd(c.priceCents)}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(c.priceAsOf ?? '')}</div>
          </div>
          <div class="text-right">
            <div class="text-[10px] uppercase tracking-wider text-slate-500">Forward yield</div>
            <div class="num font-bold text-2xl ${yieldColor(c.forwardYield)}">${fmtPct(c.forwardYield)}</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${c.frequency}</div>
          </div>
          <div class="text-center">
            <div class="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Safety</div>
            <div class="score-badge ${scoreColor(c.sustainability.total)}" style="width:3.5rem;height:3.5rem;font-size:1.25rem;">
              <span class="num">${c.sustainability.total.toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Stat grid (dividend-focused) -->
    <section class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
      ${statBox('TTM dividend', c.ttmDps !== null ? `$${c.ttmDps.toFixed(2)}` : '—', 'per share')}
      ${statBox('Trailing yield', fmtPct(c.trailingYield), '')}
      ${statBox('1y CAGR', fmtPct(data.cagr1y, 1), '')}
      ${statBox('3y CAGR', fmtPct(data.cagr3y, 1), '')}
      ${statBox('5y CAGR', fmtPct(c.cagr5y, 1), '')}
      ${statBox('10y CAGR', fmtPct(c.cagr10y, 1), '')}
      ${statBox('Growth streak', `${c.growthStreak}`, 'years')}
      ${statBox('Last dividend', c.lastDividend ? `$${c.lastDividend.amount.toFixed(4)}` : '—', c.lastDividend?.exDate ?? '')}
      ${statBox('52w high', fmtUsd(c.fiftyTwoWeekHigh), '')}
      ${statBox('52w low', fmtUsd(c.fiftyTwoWeekLow), '')}
      ${statBox('Payout ratio', fmtPct(c.payoutRatio, 0), '')}
      ${statBox('Debt/equity', fmtNum(c.debtToEquity, 2), '')}
    </section>

    <!-- Charts: annualized + sustainability -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="glass rounded-2xl p-5 lg:col-span-2">
        <h3 class="font-semibold text-slate-100 mb-1">Annualized dividends per share</h3>
        <p class="text-xs text-slate-500 mb-3">Sum of all dividends paid in each calendar year. Hover bars for detail.</p>
        <div class="h-72">
          <canvas id="annualChart"></canvas>
        </div>
      </div>
      <div class="glass rounded-2xl p-5">
        <h3 class="font-semibold text-slate-100 mb-1">Sustainability breakdown</h3>
        <p class="text-xs text-slate-500 mb-3">Component scores weighted into the total.</p>
        <div class="space-y-3">
          ${sustItems
            .map(
              (i) => `
            <div>
              <div class="flex justify-between items-baseline">
                <div class="text-sm text-slate-200">${i.name}</div>
                <div class="text-sm num ${scoreColor(i.score)}">${i.score.toFixed(0)} <span class="text-slate-500 text-xs">× ${(i.weight * 100).toFixed(0)}%</span></div>
              </div>
              <div class="h-2 mt-1 bg-slate-800 rounded-full overflow-hidden">
                <div class="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400" style="width:${Math.max(i.score, 4)}%"></div>
              </div>
            </div>
          `,
            )
            .join('')}
        </div>
        ${
          c.sustainability.warnings.length > 0
            ? `<div class="mt-4 pt-4 border-t border-slate-800/70">
                <div class="text-xs uppercase tracking-wider text-amber-400 mb-1">Warnings</div>
                <ul class="text-xs text-slate-300 space-y-1">
                  ${c.sustainability.warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('')}
                </ul>
              </div>`
            : `<div class="mt-4 pt-4 border-t border-slate-800/70 text-xs text-emerald-400">✓ No structural warnings detected.</div>`
        }
      </div>
    </section>

    ${
      fundamentalsCards.length > 0
        ? /* html */ `
    <!-- Fundamentals panel -->
    <section class="glass rounded-2xl p-5">
      <div class="flex items-baseline justify-between mb-4">
        <div>
          <h3 class="font-semibold text-slate-100">${isEtf ? 'Fund metrics' : 'Fundamentals'}</h3>
          <p class="text-xs text-slate-500">${
            isEtf
              ? 'Headline numbers from the most recent quoteSummary fetch.'
              : 'Valuation, balance sheet, and profitability ratios. Hover any card for tooltip.'
          }</p>
        </div>
        ${snap?.fetchDate ? `<span class="text-[10px] uppercase tracking-wider text-slate-500">as of ${escapeHtml(snap.fetchDate)}</span>` : ''}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        ${fundamentalsCards.join('\n')}
      </div>
    </section>
        `
        : ''
    }

    ${holdingsHtml}

    <!-- Charts: per-payment + recent table -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="glass rounded-2xl p-5 lg:col-span-2">
        <h3 class="font-semibold text-slate-100 mb-1">Per-payment dividend history</h3>
        <p class="text-xs text-slate-500 mb-3">Each point is one ex-dividend payment. Hover for detail.</p>
        <div class="h-64">
          <canvas id="historyChart"></canvas>
        </div>
      </div>
      <div class="glass rounded-2xl p-5">
        <h3 class="font-semibold text-slate-100 mb-1">Recent payments</h3>
        <p class="text-xs text-slate-500 mb-3">Last 12 ex-dates and amounts.</p>
        <table class="w-full text-sm">
          <thead>
            <tr class="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
              <th class="text-left py-2">Ex-date</th>
              <th class="text-right py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${
              lastFive.length > 0
                ? lastFive
                    .map(
                      (p) => `
              <tr class="border-b border-slate-800/40 hover:bg-slate-800/30">
                <td class="py-2 num text-slate-300">${escapeHtml(p.exDate)}</td>
                <td class="py-2 num text-right text-slate-100">$${p.amount.toFixed(4)}</td>
              </tr>`,
                    )
                    .join('')
                : '<tr><td colspan="2" class="text-slate-500 italic py-4 text-center">No dividend history</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>

    <!-- TTM cumulative -->
    <section class="glass rounded-2xl p-5">
      <h3 class="font-semibold text-slate-100 mb-1">Trailing-12-month dividend per share over time</h3>
      <p class="text-xs text-slate-500 mb-3">A smoother view than per-payment data — shows whether the income stream is rising, flat, or shrinking. Hover for exact TTM at any date.</p>
      <div class="h-72">
        <canvas id="ttmChart"></canvas>
      </div>
    </section>

    ${newsHtml}

    ${summaryHtml}
  </div>

  <script>
    (function() {
      const data = window.__TICKER__;
      const t = window.__chartTheme();
      const fmtUsd4 = (n) => '$' + n.toFixed(4);
      const fmtUsd2 = (n) => '$' + n.toFixed(2);

      const tooltipDefaults = {
        backgroundColor: t.tooltipBg,
        titleColor: t.tooltipText,
        bodyColor: t.tooltipBody,
        borderColor: t.tooltipBorder,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        displayColors: false,
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 12 },
      };

      const axis = (extra) => Object.assign({
        grid: { color: t.grid },
        ticks: { color: t.text },
      }, extra || {});

      // Annualized bar chart
      if (document.getElementById('annualChart')) {
        new Chart(document.getElementById('annualChart'), {
          type: 'bar',
          data: {
            labels: data.annualSeries.map((p) => p.year),
            datasets: [{
              label: 'Annual DPS',
              data: data.annualSeries.map((p) => p.total),
              backgroundColor: t.isLight ? 'rgba(5, 150, 105, 0.55)' : 'rgba(52, 211, 153, 0.6)',
              borderColor: t.emerald,
              borderWidth: 1,
              borderRadius: 4,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipDefaults,
                callbacks: {
                  title: (items) => 'Year ' + items[0].label,
                  label: (ctx) => 'DPS ' + fmtUsd4(ctx.parsed.y),
                },
              },
            },
            scales: {
              x: axis(),
              y: axis({
                beginAtZero: true,
                grid: { color: t.gridStrong },
                ticks: { color: t.text, callback: (v) => '$' + v.toFixed(2) },
              }),
            },
          },
        });
      }

      // Per-payment line
      if (document.getElementById('historyChart')) {
        new Chart(document.getElementById('historyChart'), {
          type: 'line',
          data: {
            datasets: [{
              label: 'Per-share dividend',
              data: data.history.map((p) => ({ x: p.exDate, y: p.amount })),
              borderColor: t.cyan,
              backgroundColor: t.cyanFill,
              borderWidth: 1.5,
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: t.cyan,
              fill: false,
              stepped: true,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipDefaults,
                callbacks: {
                  title: (items) => items[0].raw.x,
                  label: (ctx) => fmtUsd4(ctx.parsed.y) + ' / share',
                },
              },
            },
            scales: {
              x: axis({ type: 'time', time: { unit: 'year' } }),
              y: axis({
                beginAtZero: true,
                grid: { color: t.gridStrong },
                ticks: { color: t.text, callback: (v) => '$' + v.toFixed(2) },
              }),
            },
          },
        });
      }

      // TTM area
      if (document.getElementById('ttmChart')) {
        new Chart(document.getElementById('ttmChart'), {
          type: 'line',
          data: {
            datasets: [{
              label: 'TTM DPS',
              data: data.cumulative.map((p) => ({ x: p.exDate, y: p.ttm })),
              borderColor: t.emerald,
              backgroundColor: t.emeraldFill,
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointBackgroundColor: t.emerald,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                ...tooltipDefaults,
                callbacks: {
                  title: (items) => items[0].raw.x,
                  label: (ctx) => 'TTM DPS ' + fmtUsd2(ctx.parsed.y),
                },
              },
            },
            scales: {
              x: axis({ type: 'time', time: { unit: 'year' } }),
              y: axis({
                beginAtZero: true,
                grid: { color: t.gridStrong },
                ticks: { color: t.text, callback: (v) => '$' + v.toFixed(2) },
              }),
            },
          },
        });
      }

      // Sector breakdown donut
      if (document.getElementById('sectorChart') && data.sectorWeights && data.sectorWeights.length > 0) {
        const colors = ${JSON.stringify(SECTOR_COLORS)};
        new Chart(document.getElementById('sectorChart'), {
          type: 'doughnut',
          data: {
            labels: data.sectorWeights.map((s) => s.sector),
            datasets: [{
              data: data.sectorWeights.map((s) => s.pct),
              backgroundColor: data.sectorWeights.map((_, i) => colors[i % colors.length]),
              borderColor: t.isLight ? '#ffffff' : '#0b0f17',
              borderWidth: 2,
              hoverOffset: 6,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
              legend: {
                position: 'right',
                labels: {
                  color: t.legend,
                  font: { size: 11 },
                  boxWidth: 10,
                  boxHeight: 10,
                  padding: 8,
                },
              },
              tooltip: {
                ...tooltipDefaults,
                callbacks: {
                  label: (ctx) => ctx.label + ' ' + (ctx.parsed * 100).toFixed(1) + '%',
                },
              },
            },
          },
        });
      }
    })();
  </script>
  `;

  return renderLayout({
    title: c.ticker,
    active: 'ticker',
    head,
    body,
  });
}

// ----- helpers --------------------------------------------------------------

function statBox(label: string, value: string, sub: string): string {
  return `
  <div class="glass rounded-xl p-4">
    <div class="text-[10px] uppercase tracking-wider text-slate-500">${escapeHtml(label)}</div>
    <div class="num font-semibold text-slate-100 mt-1">${escapeHtml(value)}</div>
    ${sub ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

function metricCard(opts: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}): string {
  const toneClass =
    opts.tone === 'good'
      ? 'text-emerald-300'
      : opts.tone === 'bad'
        ? 'text-rose-400'
        : opts.tone === 'warn'
          ? 'text-amber-300'
          : 'text-slate-100';
  return `
  <div class="rounded-xl bg-slate-900/40 border border-slate-800/60 p-4 hover:border-emerald-500/30 transition-colors">
    <div class="text-[10px] uppercase tracking-wider text-slate-500">${escapeHtml(opts.label)}</div>
    <div class="num font-semibold text-lg ${toneClass} mt-1">${escapeHtml(opts.value)}</div>
    ${opts.sub ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(opts.sub)}</div>` : ''}
  </div>`;
}

function fmtBigUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtVol(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
function fmtRatio(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}
function fmtFracPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

function buildStockFundamentalsCards(snap: QuoteSnapshotRow | null): string[] {
  if (!snap) return [];
  const cards: string[] = [];

  // Valuation
  cards.push(metricCard({ label: 'P/E (TTM)', value: fmtRatio(snap.peTrailing) }));
  cards.push(metricCard({ label: 'P/E (Fwd)', value: fmtRatio(snap.peForward) }));
  cards.push(metricCard({ label: 'P/S (TTM)', value: fmtRatio(snap.psRatio) }));
  cards.push(metricCard({ label: 'P/B', value: fmtRatio(snap.pbRatio) }));
  cards.push(metricCard({ label: 'PEG', value: fmtRatio(snap.pegRatio) }));
  cards.push(metricCard({ label: 'Market cap', value: fmtBigUsd(snap.marketCap) }));

  // Market mechanics
  cards.push(
    metricCard({
      label: 'Volume',
      value: fmtVol(snap.volume),
      sub: snap.avgVolume3m ? `avg 3m ${fmtVol(snap.avgVolume3m)}` : undefined,
    }),
  );
  cards.push(metricCard({ label: 'Beta', value: fmtRatio(snap.beta) }));
  // Profitability
  cards.push(
    metricCard({
      label: 'EPS (TTM)',
      value: snap.epsTrailing !== null ? `$${fmtRatio(snap.epsTrailing)}` : '—',
    }),
  );
  cards.push(metricCard({ label: 'ROE', value: fmtFracPct(snap.returnOnEquity, 1) }));
  cards.push(metricCard({ label: 'Profit margin', value: fmtFracPct(snap.profitMargins, 1) }));
  cards.push(metricCard({ label: 'Free cash flow', value: fmtBigUsd(snap.freeCashFlow) }));

  // Dividend extras (the broker view, vs computed series above)
  cards.push(
    metricCard({
      label: 'Dividend rate',
      value: snap.dividendRate !== null ? `$${fmtRatio(snap.dividendRate, 4)}` : '—',
      sub: 'broker reported',
    }),
  );
  cards.push(
    metricCard({
      label: 'Yield (broker)',
      value: snap.dividendYield !== null ? fmtFracPct(snap.dividendYield, 2) : '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'Payout ratio',
      value: snap.payoutRatio !== null ? fmtFracPct(snap.payoutRatio, 0) : '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'Ex-div date',
      value: snap.exDividendDate ?? '—',
    }),
  );
  // Balance sheet
  cards.push(metricCard({ label: 'Total debt', value: fmtBigUsd(snap.totalDebt) }));
  cards.push(metricCard({ label: 'Total cash', value: fmtBigUsd(snap.totalCash) }));

  return cards;
}

function buildEtfFundamentalsCards(snap: QuoteSnapshotRow | null): string[] {
  if (!snap) return [];
  const cards: string[] = [];
  cards.push(metricCard({ label: 'AUM', value: fmtBigUsd(snap.totalAssets) }));
  cards.push(
    metricCard({
      label: 'Expense ratio',
      value: snap.expenseRatio !== null ? fmtFracPct(snap.expenseRatio, 2) : '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'Yield',
      value: snap.dividendYield !== null ? fmtFracPct(snap.dividendYield, 2) : '—',
    }),
  );
  cards.push(metricCard({ label: 'P/E (TTM)', value: fmtRatio(snap.peTrailing) }));
  cards.push(metricCard({ label: 'Beta', value: fmtRatio(snap.beta) }));
  cards.push(
    metricCard({
      label: 'Volume',
      value: fmtVol(snap.volume),
      sub: snap.avgVolume3m ? `avg 3m ${fmtVol(snap.avgVolume3m)}` : undefined,
    }),
  );
  cards.push(metricCard({ label: 'YTD return', value: fmtFracPct(snap.ytdReturn, 1) }));
  cards.push(metricCard({ label: '3y return (ann)', value: fmtFracPct(snap.threeYearReturn, 1) }));
  cards.push(metricCard({ label: '5y return (ann)', value: fmtFracPct(snap.fiveYearReturn, 1) }));
  cards.push(
    metricCard({
      label: 'Fund family',
      value: snap.fundFamily ?? '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'Inception',
      value: snap.inceptionDate ?? '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'Ex-div date',
      value: snap.exDividendDate ?? '—',
    }),
  );
  return cards;
}

function renderEtfHoldings(holdings: EtfHoldingRow[], profile: EtfProfileRow | null): string {
  if (holdings.length === 0 && (!profile || profile.sectorWeights.length === 0)) return '';

  const total = holdings.reduce((acc, h) => acc + h.allocationPct, 0);
  const totalLabel = profile?.totalHoldings
    ? `${profile.totalHoldings.toLocaleString()} total`
    : '';

  // We display the top-10 as a horizontal bar list. Width is the holding's
  // percentage relative to the largest one (so the heaviest holding always
  // hits 100% bar width — easier to compare relative weights at a glance).
  const maxPct = holdings.reduce((m, h) => Math.max(m, h.allocationPct), 0) || 1;

  const holdingsList = holdings.slice(0, 10).map((h, i) => {
    const widthPct = (h.allocationPct / maxPct) * 100;
    const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
    const ticker = h.symbol ?? '';
    // Only link if the symbol is in our tracked universe — otherwise the
    // link 404s, which is uglier than just showing the bare symbol.
    const tracked = ticker && getTicker(ticker) !== undefined;
    const tickerLink = tracked
      ? `<a href="/ticker/${escapeHtml(ticker)}" class="font-mono text-xs text-emerald-300 hover:underline">${escapeHtml(ticker)}</a>`
      : ticker
        ? `<span class="font-mono text-xs text-slate-400">${escapeHtml(ticker)}</span>`
        : '<span class="font-mono text-xs text-slate-500">—</span>';
    return /* html */ `
      <li class="grid grid-cols-[2rem_4rem_1fr_5rem] gap-3 items-center text-sm py-1.5 border-b border-slate-800/40 last:border-0">
        <span class="num text-slate-600 text-xs">${h.position}</span>
        ${tickerLink}
        <div class="min-w-0">
          <div class="text-slate-200 truncate" title="${escapeHtml(h.name)}">${escapeHtml(h.name)}</div>
          <div class="h-1 mt-1 rounded-full bg-slate-800/70 overflow-hidden">
            <div class="h-full rounded-full" style="width:${widthPct.toFixed(1)}%;background:${color}"></div>
          </div>
        </div>
        <span class="num text-right text-slate-100 font-semibold">${(h.allocationPct * 100).toFixed(2)}%</span>
      </li>
    `;
  });

  const sectorLegend = (profile?.sectorWeights ?? [])
    .slice(0, 12)
    .map((s, i) => {
      const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
      return `
        <li class="flex items-center justify-between text-xs py-1 border-b border-slate-800/40 last:border-0">
          <span class="flex items-center gap-2 truncate min-w-0">
            <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background:${color}"></span>
            <span class="text-slate-300 truncate">${escapeHtml(s.sector)}</span>
          </span>
          <span class="num text-slate-100 font-semibold ml-2">${(s.pct * 100).toFixed(1)}%</span>
        </li>`;
    })
    .join('');

  return /* html */ `
  <section class="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <div class="glass rounded-2xl p-5 lg:col-span-2">
      <div class="flex items-baseline justify-between mb-3">
        <div>
          <h3 class="font-semibold text-slate-100">Top holdings</h3>
          <p class="text-xs text-slate-500">${totalLabel || 'Top positions reported by the fund'} ${
            holdings.length > 0
              ? `· top ${holdings.length} = <span class="num text-slate-300">${(total * 100).toFixed(1)}%</span>`
              : ''
          }</p>
        </div>
      </div>
      ${
        holdings.length > 0
          ? `<ul>${holdingsList.join('')}</ul>`
          : '<p class="text-xs text-slate-500 italic">Holdings not provided by data source.</p>'
      }
    </div>
    <div class="glass rounded-2xl p-5">
      <h3 class="font-semibold text-slate-100 mb-1">Sector mix</h3>
      <p class="text-xs text-slate-500 mb-3">Allocation by GICS sector.</p>
      ${
        profile && profile.sectorWeights.length > 0
          ? /* html */ `
            <div class="h-44">
              <canvas id="sectorChart"></canvas>
            </div>
            <ul class="mt-4">${sectorLegend}</ul>
          `
          : '<p class="text-xs text-slate-500 italic">Sector breakdown not provided.</p>'
      }
    </div>
  </section>
  `;
}

function renderNewsList(news: NewsRow[]): string {
  if (news.length === 0) {
    return /* html */ `
    <section class="glass rounded-2xl p-5">
      <h3 class="font-semibold text-slate-100 mb-1">Latest news</h3>
      <p class="text-xs text-slate-500">No recent news indexed yet. Run <code class="px-1.5 py-0.5 rounded bg-slate-900/70 font-mono text-emerald-300">bun run refresh-quotes</code> to fetch.</p>
    </section>
    `;
  }

  const items = news.slice(0, 8).map((n) => {
    const ts = new Date(n.publishedAt);
    const ageMs = Date.now() - ts.getTime();
    const ageHours = ageMs / 3600_000;
    const dotClass =
      ageHours < 1 ? 'bg-rose-400 animate-pulse' : ageHours < 6 ? 'bg-amber-400' : 'bg-slate-600';
    const ageLabel = (() => {
      if (ageHours < 1) return `${Math.max(1, Math.round(ageMs / 60_000))}m ago`;
      if (ageHours < 24) return `${Math.round(ageHours)}h ago`;
      const days = Math.round(ageHours / 24);
      if (days < 30) return `${days}d ago`;
      return ts.toISOString().slice(0, 10);
    })();

    return /* html */ `
    <a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer"
       class="flex gap-4 items-start p-3 rounded-xl border border-slate-800/40 hover:border-emerald-500/40 hover:bg-slate-900/40 transition-colors group">
      <span class="mt-1.5 inline-block w-2 h-2 rounded-full ${dotClass} shrink-0" aria-hidden="true"></span>
      <div class="min-w-0 flex-1">
        <div class="text-sm text-slate-100 font-medium leading-snug group-hover:text-emerald-300 line-clamp-2">${escapeHtml(n.title)}</div>
        ${
          n.summary
            ? `<p class="text-xs text-slate-400 mt-1 leading-snug line-clamp-2">${escapeHtml(n.summary)}</p>`
            : ''
        }
        <div class="text-[11px] text-slate-500 mt-1.5 flex items-center gap-2 flex-wrap">
          ${n.publisher ? `<span class="text-slate-400">${escapeHtml(n.publisher)}</span>` : ''}
          <span class="num">${ageLabel}</span>
        </div>
      </div>
    </a>`;
  });

  return /* html */ `
  <section class="glass rounded-2xl p-5">
    <div class="flex items-baseline justify-between mb-4">
      <div>
        <h3 class="font-semibold text-slate-100">Latest news</h3>
        <p class="text-xs text-slate-500">Headlines from Yahoo Finance, sorted by publication time.</p>
      </div>
      <span class="text-[10px] uppercase tracking-wider text-slate-500">${news.length} items</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${items.join('')}
    </div>
  </section>
  `;
}

function renderSummary(summary: string, website: string | null): string {
  // Allow the summary to be quite long but keep it collapsed by default to
  // avoid pushing the page to absurd lengths for ETFs with verbose
  // descriptions.
  const escaped = escapeHtml(summary);
  return /* html */ `
  <section class="glass rounded-2xl p-5">
    <div class="flex items-baseline justify-between mb-2">
      <h3 class="font-semibold text-slate-100">About</h3>
      ${
        website
          ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" class="text-xs text-emerald-300 hover:underline">${escapeHtml(website)} →</a>`
          : ''
      }
    </div>
    <details class="text-sm text-slate-300 leading-relaxed">
      <summary class="cursor-pointer text-slate-400 hover:text-slate-200 select-none">Show description</summary>
      <p class="mt-3 whitespace-pre-line">${escaped}</p>
    </details>
  </section>
  `;
}

/**
 * Compute trailing-12-month rolling sum at each historical event.
 */
function computeTtmSeries(
  events: { exDate: string; amount: number }[],
): { exDate: string; ttm: number }[] {
  const sorted = [...events].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
  return sorted.map((e, i) => {
    const upTo = sorted.slice(0, i + 1);
    const cutoff = (() => {
      const d = new Date(e.exDate);
      d.setFullYear(d.getFullYear() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const ttm = upTo.filter((p) => p.exDate > cutoff).reduce((acc, p) => acc + p.amount, 0);
    return { exDate: e.exDate, ttm };
  });
}
