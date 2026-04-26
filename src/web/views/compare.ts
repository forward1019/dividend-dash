/**
 * Compare view (v0.5).
 *
 * Pick up to 6 tickers and see them side-by-side: TTM-DPS overlay chart,
 * yield-vs-growth scatter, and a sortable metrics table. When the URL
 * is empty we pre-load the top 3 by safety score so the page is never a
 * blank state.
 *
 * Tickers come from URL params (?t=SCHD&t=VYM). The picker uses Alpine
 * for fuzzy filter; selection happens via real navigations so URL state
 * stays the source of truth.
 */

import type { TickerCard } from '../data.ts';
import { escapeHtml, fmtPct, fmtUsd, renderLayout, scoreToGrade, yieldColor } from './layout.ts';

interface ComparePageData {
  /** All universe cards, used to populate the picker. */
  allCards: TickerCard[];
  /** The currently selected cards (matches the URL). */
  selected: TickerCard[];
  /** TTM DPS time series, keyed by ticker. */
  series: Record<string, { exDate: string; ttm: number }[]>;
  /** True when the URL was empty and we substituted suggestions. */
  isPreview: boolean;
}

const PALETTE = ['#34d399', '#22d3ee', '#a78bfa', '#fbbf24', '#fb7185', '#60a5fa'];
const PALETTE_LIGHT = ['#059669', '#0891b2', '#7c3aed', '#b45309', '#be123c', '#2563eb'];

export function renderComparePage(data: ComparePageData): string {
  // Scatter data: yield (x) vs 5y CAGR (y) for ALL cards, with selected ones
  // highlighted. This is the "what does the universe look like" picture.
  const scatterAll = data.allCards
    .filter((c) => c.forwardYield !== null && c.cagr5y !== null)
    .map((c) => ({
      ticker: c.ticker,
      x: (c.forwardYield ?? 0) * 100,
      y: (c.cagr5y ?? 0) * 100,
      kind: c.kind,
      sustainability: c.sustainability.total,
    }));
  const scatterSelected = data.selected
    .filter((c) => c.forwardYield !== null && c.cagr5y !== null)
    .map((c) => ({
      ticker: c.ticker,
      x: (c.forwardYield ?? 0) * 100,
      y: (c.cagr5y ?? 0) * 100,
    }));

  const head = `<script>
    window.__COMPARE__ = ${JSON.stringify({
      selected: data.selected.map((c) => c.ticker),
      series: data.series,
      scatterAll,
      scatterSelected,
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

    <div>
      <h1 class="display text-3xl ink">Compare</h1>
      <p class="text-[13px] muted mt-1">
        Pick up to 6 tickers to see their dividend trajectories, yield-vs-growth position, and side-by-side metrics.
        ${data.isPreview ? '<span class="accent-text"> · showing top-3 by safety as a preview · </span>' : ''}
      </p>
    </div>

    <!-- Picker -->
    <section class="surface p-4">
      <div class="flex flex-wrap gap-2 mb-3" id="selected-pills">
        ${data.selected
          .map((c, i) => {
            const color = PALETTE[i % PALETTE.length];
            return `
          <span class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-mono"
                style="background: ${color}20; color: ${color}; border: 1px solid ${color}55;">
            ${escapeHtml(c.ticker)}
            <a href="${makeRemoveUrl(data.selected, c.ticker)}" class="muted hover:text-[var(--negative)]" title="Remove" style="text-decoration:none;color:inherit;opacity:.7;">×</a>
          </span>`;
          })
          .join('')}
        ${
          data.selected.length === 0
            ? '<span class="text-[12px] faint italic">Add a ticker to start.</span>'
            : ''
        }
      </div>

      <div class="relative">
        <input
          x-model="search"
          @focus="open = true"
          @blur="setTimeout(() => open = false, 200)"
          placeholder="Add a ticker (e.g. SCHD, JNJ)…"
          class="input w-full"
          style="padding-top:8px;padding-bottom:8px;"
          autocomplete="off"
        >
        <div
          x-show="open && filtered.length > 0"
          class="absolute z-10 mt-1 w-full max-h-80 overflow-y-auto"
          style="background: var(--bg-elev); border:1px solid var(--rule-strong); border-radius:10px; box-shadow: 0 16px 32px -8px rgba(0,0,0,.35);"
          x-cloak
        >
          <template x-for="t in filtered" :key="t.ticker">
            <a :href="addUrl(t.ticker)" class="block px-3 py-2 dd-cmdk-item" style="text-decoration:none;color:inherit;">
              <div class="flex items-center gap-2">
                <span class="font-mono font-semibold ink" x-text="t.ticker"></span>
                <span class="text-[12px] muted truncate" x-text="t.name"></span>
              </div>
              <div class="text-[10.5px] muted ml-0.5" x-text="t.category"></div>
            </a>
          </template>
        </div>
      </div>
    </section>

    <!-- Yield-vs-Growth scatter (always shown — no selection required) -->
    <section class="surface p-4">
      <div class="flex items-baseline justify-between mb-2">
        <div>
          <h3 class="editorial text-base ink">Yield vs. 5-year dividend growth</h3>
          <p class="text-[11.5px] muted">All ${data.allCards.length} tickers plotted. The sweet spot is upper-right: high yield AND high growth. Selected tickers are highlighted.</p>
        </div>
      </div>
      <div class="relative" style="height:340px;">
        <canvas id="scatterChart"></canvas>
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
            .filter((t) => t.ticker.includes(s) || (t.name || '').toUpperCase().includes(s))
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
          if (window.__COMPARE_RENDERED__) return;
          window.__COMPARE_RENDERED__ = true;
          renderCompareCharts();
        },
      };
    }

    function renderCompareCharts() {
      const cmp = window.__COMPARE__;
      if (!cmp) return;
      const theme = window.__chartTheme();
      const palette = theme.isLight ? ${JSON.stringify(PALETTE_LIGHT)} : ${JSON.stringify(PALETTE)};

      // Overlay chart (only when selections exist)
      if (cmp.selected.length > 0 && document.getElementById('compareChart')) {
        const datasets = cmp.selected.map((t, i) => ({
          label: t,
          data: (cmp.series[t] || []).map((p) => ({ x: p.exDate, y: p.ttm })),
          borderColor: palette[i % palette.length],
          backgroundColor: palette[i % palette.length] + '22',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0, pointHoverRadius: 5,
        }));
        new Chart(document.getElementById('compareChart'), {
          type: 'line',
          data: { datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { labels: { color: theme.legend, font: { size: 11 } } },
              tooltip: {
                backgroundColor: theme.tooltipBg, titleColor: theme.tooltipText,
                bodyColor: theme.tooltipBody, borderColor: theme.tooltipBorder, borderWidth: 1,
                padding: 10, cornerRadius: 6,
                callbacks: {
                  title: (items) => items[0].raw.x,
                  label: (ctx) => ctx.dataset.label + ': $' + ctx.parsed.y.toFixed(4) + ' TTM',
                },
              },
            },
            scales: {
              x: { type: 'time', time: { unit: 'year' }, grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
              y: { beginAtZero: true, grid: { color: theme.gridStrong }, ticks: { color: theme.text, font: { size: 10 }, callback: (v) => '$' + v.toFixed(2) } },
            },
          },
        });
      }

      // Scatter
      if (document.getElementById('scatterChart')) {
        const selectedSet = new Set(cmp.scatterSelected.map((p) => p.ticker));
        const others = cmp.scatterAll.filter((p) => !selectedSet.has(p.ticker));
        const sel = cmp.scatterAll.filter((p) => selectedSet.has(p.ticker));
        new Chart(document.getElementById('scatterChart'), {
          type: 'scatter',
          data: {
            datasets: [
              {
                label: 'Universe',
                data: others.map((p) => ({ x: p.x, y: p.y, ticker: p.ticker })),
                backgroundColor: theme.isLight ? 'rgba(15,23,36,0.16)' : 'rgba(148,163,184,0.30)',
                borderColor: theme.isLight ? 'rgba(15,23,36,0.30)' : 'rgba(148,163,184,0.45)',
                borderWidth: 1, pointRadius: 4, pointHoverRadius: 7,
              },
              {
                label: 'Selected',
                data: sel.map((p) => ({ x: p.x, y: p.y, ticker: p.ticker })),
                backgroundColor: theme.emerald,
                borderColor: theme.isLight ? '#fff' : '#0a0d14',
                borderWidth: 2, pointRadius: 7, pointHoverRadius: 10,
              },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { labels: { color: theme.legend, font: { size: 11 }, boxWidth: 10 } },
              tooltip: {
                backgroundColor: theme.tooltipBg, titleColor: theme.tooltipText,
                bodyColor: theme.tooltipBody, borderColor: theme.tooltipBorder, borderWidth: 1,
                callbacks: {
                  label: (ctx) => ctx.raw.ticker + ': yield ' + ctx.raw.x.toFixed(2) + '%, CAGR ' + ctx.raw.y.toFixed(1) + '%',
                },
              },
            },
            scales: {
              x: { title: { display: true, text: 'Forward yield (%)', color: theme.text }, grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
              y: { title: { display: true, text: '5-year dividend CAGR (%)', color: theme.text }, grid: { color: theme.grid }, ticks: { color: theme.text, font: { size: 10 } } },
            },
          },
        });
      }
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
      const grade = scoreToGrade(c.sustainability.total);
      const cagrCls = c.cagr5y === null ? 'muted' : c.cagr5y >= 0 ? 'positive' : 'negative';
      return `
    <tr>
      <td>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full" style="background: ${color}"></span>
          <a href="/ticker/${escapeHtml(c.ticker)}" class="ticker-cell" style="text-decoration:none;">${escapeHtml(c.ticker)}</a>
        </div>
        <div class="text-[11px] muted mt-0.5 truncate max-w-[220px]">${escapeHtml(c.name)}</div>
      </td>
      <td class="num-cell">${fmtUsd(c.priceCents)}</td>
      <td class="num-cell ${yieldColor(c.forwardYield)}">${fmtPct(c.forwardYield)}</td>
      <td class="num-cell ${cagrCls}">${fmtPct(c.cagr5y, 1)}</td>
      <td class="num-cell">${c.growthStreak}<span class="muted text-[10px] ml-0.5">y</span></td>
      <td class="text-right"><span class="grade ${grade.cls}" style="width:30px;height:30px;font-size:13px;">${grade.letter}</span></td>
      <td class="text-right muted text-[12px] capitalize">${c.frequency}</td>
    </tr>`;
    })
    .join('');

  return /* html */ `
    <section class="surface p-4">
      <div class="flex items-baseline justify-between mb-2">
        <h3 class="editorial text-base ink">TTM dividends per share over time</h3>
        <span class="text-[11px] muted">trailing-12-month per share, by ex-date</span>
      </div>
      <div class="relative" style="height:340px;">
        <canvas id="compareChart"></canvas>
      </div>
    </section>

    <section class="surface p-4 overflow-x-auto">
      <h3 class="editorial text-base ink mb-3">Side-by-side metrics</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th class="text-right">Price</th>
            <th class="text-right">Fwd yield</th>
            <th class="text-right">5y CAGR</th>
            <th class="text-right">Streak</th>
            <th class="text-right">Safety</th>
            <th class="text-right">Cadence</th>
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
