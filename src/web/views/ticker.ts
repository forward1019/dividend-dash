/**
 * Per-ticker drill-down view.
 *
 * Layout:
 *   - Hero (price, yield, sustainability score, growth streak)
 *   - Dividend history line chart (per-share + cumulative)
 *   - Yield-on-cost projection if a fictional cost basis is provided
 *   - Sustainability scorecard breakdown (4 components, weighted)
 *   - Recent payments table (last 12 events)
 *   - Stats grid (CAGR 1/3/5/10y, frequency, last raise, payout ratio)
 */

import type { DividendHistoryPoint, TickerCard } from '../data.ts';
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
}

export function renderTickerPage(data: TickerPageData): string {
  const c = data.card;
  const h = data.history;

  // Build cumulative TTM dividend series for chart
  const cumulative = computeTtmSeries(h);

  // Annualized DPS by year for grouped bar chart
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

  const head = `<script>
    window.__TICKER__ = ${JSON.stringify({
      ticker: c.ticker,
      history: h,
      cumulative,
      annualSeries,
    })};
  </script>`;

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
        <div>
          <div class="flex items-center gap-3">
            <h1 class="font-bold text-3xl font-mono">${escapeHtml(c.ticker)}</h1>
            ${
              c.kind === 'etf'
                ? '<span class="text-xs px-2 py-1 rounded bg-cyan-500/15 text-cyan-300 font-mono">ETF</span>'
                : '<span class="text-xs px-2 py-1 rounded bg-violet-500/15 text-violet-300 font-mono">STOCK</span>'
            }
            <span class="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300">${escapeHtml(c.categoryLabel)}</span>
          </div>
          <p class="text-slate-300 mt-1">${escapeHtml(c.name)}</p>
          ${c.notes ? `<p class="text-sm text-slate-500 mt-1 italic">${escapeHtml(c.notes)}</p>` : ''}
        </div>
        <div class="flex items-center gap-6">
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

    <!-- Stats grid -->
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

    <!-- Charts -->
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
  </div>

  <script>
    (function() {
      const data = window.__TICKER__;
      const fmtUsd = (n) => '$' + n.toFixed(4);
      const fmtUsd2 = (n) => '$' + n.toFixed(2);

      const tooltipDefaults = {
        backgroundColor: 'rgba(15, 23, 36, 0.95)',
        titleColor: '#e2e8f0',
        bodyColor: '#cbd5e1',
        borderColor: 'rgba(52, 211, 153, 0.4)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        displayColors: false,
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 12 },
      };

      // Annualized bar chart
      if (document.getElementById('annualChart')) {
        new Chart(document.getElementById('annualChart'), {
          type: 'bar',
          data: {
            labels: data.annualSeries.map((p) => p.year),
            datasets: [{
              label: 'Annual DPS',
              data: data.annualSeries.map((p) => p.total),
              backgroundColor: 'rgba(52, 211, 153, 0.6)',
              borderColor: 'rgb(52, 211, 153)',
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
                  label: (ctx) => 'DPS ' + fmtUsd(ctx.parsed.y),
                },
              },
            },
            scales: {
              x: {
                grid: { color: 'rgba(148, 163, 184, 0.05)' },
                ticks: { color: '#94a3b8' },
              },
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(148, 163, 184, 0.07)' },
                ticks: { color: '#94a3b8', callback: (v) => '$' + v.toFixed(2) },
              },
            },
          },
        });
      }

      // Per-payment scatter line
      if (document.getElementById('historyChart')) {
        new Chart(document.getElementById('historyChart'), {
          type: 'line',
          data: {
            datasets: [{
              label: 'Per-share dividend',
              data: data.history.map((p) => ({ x: p.exDate, y: p.amount })),
              borderColor: 'rgb(34, 211, 238)',
              backgroundColor: 'rgba(34, 211, 238, 0.1)',
              borderWidth: 1.5,
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: 'rgb(34, 211, 238)',
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
                  label: (ctx) => fmtUsd(ctx.parsed.y) + ' / share',
                },
              },
            },
            scales: {
              x: {
                type: 'time',
                time: { unit: 'year' },
                grid: { color: 'rgba(148, 163, 184, 0.05)' },
                ticks: { color: '#94a3b8' },
              },
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(148, 163, 184, 0.07)' },
                ticks: { color: '#94a3b8', callback: (v) => '$' + v.toFixed(2) },
              },
            },
          },
        });
      }

      // TTM area chart
      if (document.getElementById('ttmChart')) {
        new Chart(document.getElementById('ttmChart'), {
          type: 'line',
          data: {
            datasets: [{
              label: 'TTM DPS',
              data: data.cumulative.map((p) => ({ x: p.exDate, y: p.ttm })),
              borderColor: 'rgb(52, 211, 153)',
              backgroundColor: 'rgba(52, 211, 153, 0.18)',
              borderWidth: 2,
              fill: true,
              tension: 0.3,
              pointRadius: 0,
              pointHoverRadius: 6,
              pointBackgroundColor: 'rgb(52, 211, 153)',
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
              x: {
                type: 'time',
                time: { unit: 'year' },
                grid: { color: 'rgba(148, 163, 184, 0.05)' },
                ticks: { color: '#94a3b8' },
              },
              y: {
                beginAtZero: true,
                grid: { color: 'rgba(148, 163, 184, 0.07)' },
                ticks: { color: '#94a3b8', callback: (v) => '$' + v.toFixed(2) },
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

function statBox(label: string, value: string, sub: string): string {
  return `
  <div class="glass rounded-xl p-4">
    <div class="text-[10px] uppercase tracking-wider text-slate-500">${escapeHtml(label)}</div>
    <div class="num font-semibold text-slate-100 mt-1">${escapeHtml(value)}</div>
    ${sub ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(sub)}</div>` : ''}
  </div>`;
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
