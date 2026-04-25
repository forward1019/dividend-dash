/**
 * Compare view — pick up to 4 tickers and see their TTM DPS over time
 * and key metrics side-by-side.
 *
 * Tickers are URL params (`?t=SCHD&t=VYM&t=VIG`), client-side picker
 * adds/removes them via Alpine.
 */

import type { TickerCard } from '../data.ts';
import { escapeHtml, fmtPct, fmtUsd, renderLayout, scoreColor, yieldColor } from './layout.ts';

interface ComparePageData {
  /** All universe cards, used to populate the picker. */
  allCards: TickerCard[];
  /** The currently selected cards (matches the URL). */
  selected: TickerCard[];
  /** TTM DPS time series, keyed by ticker. */
  series: Record<string, { exDate: string; ttm: number }[]>;
}

const PALETTE = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#fb7185', '#60a5fa'];

export function renderComparePage(data: ComparePageData): string {
  const head = `<script>
    window.__COMPARE__ = ${JSON.stringify({
      selected: data.selected.map((c) => c.ticker),
      series: data.series,
    })};
    window.__ALL_TICKERS__ = ${JSON.stringify(
      data.allCards.map((c) => ({
        ticker: c.ticker,
        name: c.name,
        category: c.categoryLabel,
      })),
    )};
  </script>`;

  const body = /* html */ `
  <div class="space-y-6" x-data="compare()" x-init="init()">

    <h1 class="text-2xl font-bold">Compare</h1>
    <p class="text-sm text-slate-400 -mt-4">
      Pick up to 6 tickers to compare their dividend trajectories and key metrics side-by-side.
    </p>

    <!-- Picker -->
    <section class="glass rounded-2xl p-5">
      <div class="flex flex-wrap gap-2 mb-4" id="selected-pills">
        ${data.selected
          .map(
            (c, i) => `
          <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-mono"
                style="background: ${PALETTE[i % PALETTE.length]}22; color: ${PALETTE[i % PALETTE.length]}; border: 1px solid ${PALETTE[i % PALETTE.length]}55;">
            ${escapeHtml(c.ticker)}
            <a href="${makeRemoveUrl(data.selected, c.ticker)}" class="text-slate-400 hover:text-rose-400" title="Remove">×</a>
          </span>
        `,
          )
          .join('')}
        ${
          data.selected.length === 0
            ? '<span class="text-sm text-slate-500 italic">Select tickers below to compare.</span>'
            : ''
        }
      </div>

      <div class="relative">
        <input
          x-model="search"
          @focus="open = true"
          @blur="setTimeout(() => open = false, 200)"
          placeholder="Add a ticker (e.g. SCHD, JNJ)…"
          class="w-full bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-slate-500"
          autocomplete="off"
        >
        <div
          x-show="open && filtered.length > 0"
          class="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden max-h-80 overflow-y-auto"
          x-cloak
        >
          <template x-for="t in filtered" :key="t.ticker">
            <a
              :href="addUrl(t.ticker)"
              class="block px-3 py-2 hover:bg-slate-800 cursor-pointer"
            >
              <div class="flex items-center gap-2">
                <span class="font-mono font-semibold text-slate-100" x-text="t.ticker"></span>
                <span class="text-xs text-slate-400 truncate" x-text="t.name"></span>
              </div>
              <div class="text-[10px] text-slate-500" x-text="t.category"></div>
            </a>
          </template>
        </div>
      </div>
    </section>

    ${data.selected.length === 0 ? '' : renderComparisonContent(data)}
  </div>

  <script>
    function compare() {
      return {
        search: '',
        open: false,
        get filtered() {
          const all = window.__ALL_TICKERS__ || [];
          const s = this.search.trim().toUpperCase();
          if (!s) return all.slice(0, 12);
          return all
            .filter((t) =>
              t.ticker.includes(s) || (t.name || '').toUpperCase().includes(s)
            )
            .slice(0, 12);
        },
        addUrl(ticker) {
          const url = new URL(window.location.href);
          const existing = url.searchParams.getAll('t');
          if (existing.includes(ticker)) return url.toString();
          url.searchParams.append('t', ticker);
          return url.toString();
        },
        init() {
          // Guard against Alpine re-running init after async script loads,
          // which would re-attach Chart.js to the same canvas.
          if (window.__COMPARE_RENDERED__) return;
          window.__COMPARE_RENDERED__ = true;
          renderCompareChart();
        },
      };
    }

    function renderCompareChart() {
      const cmp = window.__COMPARE__;
      if (!cmp || cmp.selected.length === 0) return;
      const palette = ${JSON.stringify(PALETTE)};
      const datasets = cmp.selected.map((t, i) => ({
        label: t,
        data: (cmp.series[t] || []).map((p) => ({ x: p.exDate, y: p.ttm })),
        borderColor: palette[i % palette.length],
        backgroundColor: palette[i % palette.length] + '22',
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 5,
      }));

      const canvas = document.getElementById('compareChart');
      if (!canvas) return;
      new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: '#cbd5e1' } },
            tooltip: {
              backgroundColor: 'rgba(15, 23, 36, 0.95)',
              titleColor: '#e2e8f0',
              bodyColor: '#cbd5e1',
              borderColor: 'rgba(52, 211, 153, 0.4)',
              borderWidth: 1,
              padding: 10,
              cornerRadius: 6,
              callbacks: {
                title: (items) => items[0].raw.x,
                label: (ctx) => ctx.dataset.label + ': $' + ctx.parsed.y.toFixed(4) + ' TTM',
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
  </script>

  <style>[x-cloak]{display:none !important;}</style>
  `;

  return renderLayout({
    title: 'Compare',
    active: 'compare',
    head,
    body,
  });
}

function renderComparisonContent(data: ComparePageData): string {
  const rows = data.selected
    .map((c, i) => {
      const color = PALETTE[i % PALETTE.length];
      return `
    <tr class="border-b border-slate-800/40 hover:bg-slate-800/30">
      <td class="py-3 px-3">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full" style="background: ${color}"></span>
          <a href="/ticker/${escapeHtml(c.ticker)}" class="font-mono font-semibold text-slate-100 hover:text-emerald-400">${escapeHtml(c.ticker)}</a>
        </div>
        <div class="text-xs text-slate-500 mt-0.5">${escapeHtml(c.name)}</div>
      </td>
      <td class="py-3 px-3 num text-slate-200 text-right">${fmtUsd(c.priceCents)}</td>
      <td class="py-3 px-3 num text-right ${yieldColor(c.forwardYield)}">${fmtPct(c.forwardYield)}</td>
      <td class="py-3 px-3 num text-right ${c.cagr5y !== null && c.cagr5y >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${fmtPct(c.cagr5y, 1)}</td>
      <td class="py-3 px-3 num text-right text-slate-200">${c.growthStreak}</td>
      <td class="py-3 px-3 text-right">
        <span class="${scoreColor(c.sustainability.total)} font-semibold num">${c.sustainability.total.toFixed(0)}</span>
      </td>
      <td class="py-3 px-3 text-right text-slate-400 text-xs capitalize">${c.frequency}</td>
    </tr>`;
    })
    .join('');

  return /* html */ `
    <section class="glass rounded-2xl p-5">
      <h3 class="font-semibold text-slate-100 mb-1">TTM dividends per share</h3>
      <p class="text-xs text-slate-500 mb-3">Rolling 12-month dividend per share for each selected ticker. Hover the chart for exact values.</p>
      <div class="h-96">
        <canvas id="compareChart"></canvas>
      </div>
    </section>

    <section class="glass rounded-2xl p-5 overflow-x-auto">
      <h3 class="font-semibold text-slate-100 mb-3">Side-by-side metrics</h3>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
            <th class="py-2 px-3 text-left">Ticker</th>
            <th class="py-2 px-3 text-right">Price</th>
            <th class="py-2 px-3 text-right">Fwd yield</th>
            <th class="py-2 px-3 text-right">5y CAGR</th>
            <th class="py-2 px-3 text-right">Streak</th>
            <th class="py-2 px-3 text-right">Safety</th>
            <th class="py-2 px-3 text-right">Cadence</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function makeRemoveUrl(selected: TickerCard[], remove: string): string {
  const params = selected
    .map((c) => c.ticker)
    .filter((t) => t !== remove)
    .map((t) => `t=${encodeURIComponent(t)}`)
    .join('&');
  return `/compare${params ? `?${params}` : ''}`;
}
