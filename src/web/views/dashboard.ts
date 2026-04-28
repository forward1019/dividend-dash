/**
 * Dashboard view (v0.6).
 *
 * The cleanup pass. v0.5 had 5 dense sections and 60 cards eating 80% of
 * the page. v0.6 collapses to 4 calmer sections, the home page is one
 * scroll, and browse defaults to a dense table instead of a card grid.
 *
 *   1. Hero — editorial intro line + 4 KPIs (tracked / yield / safety /
 *      90d income). One inline "universe shape" strip below for sector,
 *      kind, and frequency counts. No mini charts on home.
 *   2. Income outlook — single 13-week bar chart, 30/60/90 strip, and a
 *      compact list of largest upcoming.
 *   3. Movers — three lean leaderboards (top yield / growth / streak),
 *      no surface borders, just labelled lists.
 *   4. Browse — search + filter chips + dense data table by default.
 *      Toggle to grid view for the days you want pictures.
 *
 * Charts moved off home page (sector donut, yield histogram, frequency
 * mix bars) — the per-ticker page and /compare carry that detail.
 */

import type { IncomeOutlook, Leaderboards, TickerCard, UniverseStats } from '../data.ts';
import { CATEGORY_LABELS, type UniverseCategory } from '../tickers.ts';
import { escapeHtml, fmtPct, fmtUsd, renderLayout, scoreToGrade, yieldColor } from './layout.ts';

interface DashboardData {
  cards: TickerCard[];
  history: Record<string, { exDate: string; amount: number }[]>;
  stats: UniverseStats;
  outlook: IncomeOutlook;
  leaderboards: Leaderboards;
}

export function renderDashboard(data: DashboardData): string {
  const { cards, history, stats, outlook, leaderboards } = data;
  const totalCount = cards.length;

  // categories present, sorted by count
  const categoryCounts = cards.reduce<Record<UniverseCategory, number>>(
    (acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    },
    {} as Record<UniverseCategory, number>,
  );
  const categoryEntries = Object.entries(categoryCounts) as [UniverseCategory, number][];
  categoryEntries.sort((a, b) => b[1] - a[1]);

  const rowsHtml = cards.map((c) => renderTickerRow(c, history[c.ticker] ?? [])).join('\n');
  const cardsHtml = cards.map((c) => renderCard(c, history[c.ticker] ?? [])).join('\n');

  // Embed JSON for sparklines + 13-week outlook
  const head = `<script>window.__DASHBOARD__ = ${JSON.stringify({
    weeklyBuckets: outlook.weeklyBuckets,
    sparkData: Object.fromEntries(
      Object.entries(history).map(([t, h]) => [t, h.slice(-20).map((p) => p.amount)]),
    ),
  })};</script>`;

  // Most recent priceAsOf across the universe
  const asOf =
    cards
      .map((c) => c.priceAsOf)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  // Universe shape: 3 inline counts (etf/stock, top sectors, frequencies)
  const topFreq = stats.frequencyMix.slice(0, 3);

  const body = /* html */ `
  <div x-data="dashboard()" x-init="init()" class="space-y-12">

    <!-- ============= 1. HERO ============= -->
    <section class="space-y-6">
      <div class="flex items-baseline gap-3">
        <span class="label">Universe</span>
        <span class="text-[12px] muted">refresh via <code class="num text-[11px] ink-3">bun run refresh-quotes</code></span>
      </div>
      <div>
        <h1 class="display text-[40px] ink leading-[1.05]" style="letter-spacing:-0.025em;">
          ${totalCount} dividend payers, tracked.
        </h1>
        <p class="text-[14px] muted mt-2 max-w-2xl">
          ${stats.etfCount} ETFs and ${stats.stockCount} stocks across ${categoryEntries.length} categories,
          paying ${stats.totalDividendEvents.toLocaleString()} historical dividends.
          ${asOf ? `Quotes as of <span class="num ink-3">${escapeHtml(asOf)}</span>.` : ''}
        </p>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="kpi">
          <span class="label">Forward yield (avg)</span>
          <div class="value accent-text">${fmtPct(stats.avgForwardYield, 2)}</div>
          <div class="sub">${cards.filter((c) => c.forwardYield !== null).length} priced names</div>
        </div>
        <div class="kpi">
          <span class="label">Safety score (avg)</span>
          <div class="value">${stats.avgSustainability.toFixed(0)}<span class="text-base muted ml-1">/100</span></div>
          <div class="sub">avg payout ${fmtPct(stats.avgPayoutRatio, 0)}</div>
        </div>
        <div class="kpi">
          <span class="label">Next 30d income</span>
          <div class="value">${outlook.next30.estPerShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${outlook.next30.count} ex-dates</div>
        </div>
        <div class="kpi">
          <span class="label">Next 90d income</span>
          <div class="value">${outlook.next90.estPerShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${outlook.next90.count} ex-dates · <a href="/calendar" class="accent-text hover:underline">calendar →</a></div>
        </div>
      </div>

      <!-- Universe shape: inline strip, no charts -->
      <div class="text-[12.5px] ink-3 flex flex-wrap gap-x-6 gap-y-2 pt-1" style="border-top:1px solid var(--rule);padding-top:14px;">
        <span class="muted">Mix</span>
        <span><span class="num ink">${stats.etfCount}</span> ETFs · <span class="num ink">${stats.stockCount}</span> stocks</span>
        <span class="muted">·</span>
        ${topFreq
          .map(
            (f) =>
              `<span><span class="num ink">${f.count}</span> <span class="capitalize">${escapeHtml(f.frequency)}</span></span>`,
          )
          .join('<span class="muted">·</span>')}
        <span class="muted">·</span>
        <span>top sectors:
          ${stats.sectorMix
            .slice(0, 4)
            .map(
              (s) =>
                `<span class="ink">${escapeHtml(s.sector)}</span> <span class="num muted">${s.count}</span>`,
            )
            .join(' · ')}
        </span>
      </div>
    </section>

    <!-- ============= 2. INCOME OUTLOOK ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Income outlook · next 90 days</span>
          <span class="text-[12px] muted hidden md:inline">projected $/share by week</span>
        </div>
        <a href="/calendar" class="text-[12px] accent-text hover:underline">Full calendar →</a>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2">
          <div class="grid grid-cols-3 gap-6 mb-5">
            <div>
              <div class="label">30 days</div>
              <div class="num text-[26px] ink mt-1.5 leading-none">${outlook.next30.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11.5px] muted mt-1">${outlook.next30.count} payments</div>
            </div>
            <div>
              <div class="label">60 days</div>
              <div class="num text-[26px] ink mt-1.5 leading-none">${outlook.next60.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11.5px] muted mt-1">${outlook.next60.count} payments</div>
            </div>
            <div>
              <div class="label">90 days</div>
              <div class="num text-[26px] accent-text mt-1.5 leading-none">${outlook.next90.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11.5px] muted mt-1">${outlook.next90.count} payments</div>
            </div>
          </div>
          <div class="relative" style="height:140px;">
            <canvas id="dd-outlook-bars"></canvas>
          </div>
          <div class="text-[10.5px] faint mt-2">Per-share dividends grouped by week from today.</div>
        </div>
        <div>
          <div class="flex items-baseline justify-between mb-3">
            <span class="label">Largest upcoming</span>
            <span class="text-[10.5px] faint">$/sh</span>
          </div>
          <div class="space-y-0.5">
            ${
              outlook.topUpcoming
                .slice(0, 6)
                .map(
                  (
                    e,
                  ) => `<a href="/ticker/${escapeHtml(e.ticker)}" class="flex items-center gap-3 px-2 py-2 rounded-md text-[13px] hover:bg-[var(--surface-2)] transition-colors" style="text-decoration:none;color:inherit;">
                  <span class="font-mono font-semibold ink w-14">${escapeHtml(e.ticker)}</span>
                  <span class="text-[11.5px] muted flex-1 truncate">${escapeHtml(e.exDate)}</span>
                  <span class="num ink">$${e.amount.toFixed(3)}</span>
                </a>`,
                )
                .join('') ||
              '<div class="text-[12px] faint italic px-2 py-3">No upcoming payments in the window.</div>'
            }
          </div>
        </div>
      </div>
    </section>

    <!-- ============= 3. MOVERS ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Movers</span>
          <span class="text-[12px] muted hidden md:inline">top 5 across the universe</span>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
        ${renderLeaderboard('Top forward yield', leaderboards.topYield, (c) => fmtPct(c.forwardYield, 2), 'accent-text')}
        ${renderLeaderboard('Fastest 5y growth', leaderboards.topGrowth, (c) => fmtPct(c.cagr5y, 1), 'positive')}
        ${renderLeaderboard('Longest growth streak', leaderboards.topStreak, (c) => `${c.growthStreak}y`, 'ink')}
      </div>
    </section>

    <!-- ============= 4. BROWSE ============= -->
    <section class="space-y-4">
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Browse the universe</span>
          <span class="text-[12px] muted hidden md:inline" x-text="visibleCount + ' of ${totalCount} showing'">${totalCount} of ${totalCount} showing</span>
        </div>
        <div class="flex items-center gap-3 text-[12px]">
          <button @click="view = 'list'" :class="view === 'list' ? 'ink' : 'muted hover:ink'" class="transition-colors" type="button">List</button>
          <span class="faint">·</span>
          <button @click="view = 'grid'" :class="view === 'grid' ? 'ink' : 'muted hover:ink'" class="transition-colors" type="button">Grid</button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[220px]">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            x-model="search"
            placeholder="Filter by ticker or name…"
            class="input w-full pl-9"
            style="padding-top:9px;padding-bottom:9px;"
          >
        </div>
        <select x-model="kind" class="input">
          <option value="all">All kinds</option>
          <option value="etf">ETFs only</option>
          <option value="stock">Stocks only</option>
        </select>
        <select x-model="sortBy" class="input">
          <option value="ticker">Sort: A–Z</option>
          <option value="forwardYield">Sort: forward yield ↓</option>
          <option value="sustainability">Sort: safety ↓</option>
          <option value="growthStreak">Sort: streak ↓</option>
          <option value="cagr5y">Sort: 5y CAGR ↓</option>
        </select>
      </div>

      <div class="flex flex-wrap gap-2">
        <button @click="category = 'all'" :class="category === 'all' ? 'is-active' : ''" class="chip" type="button">
          All <span class="count">${totalCount}</span>
        </button>
        ${categoryEntries
          .map(
            ([cat, count]) =>
              `<button @click="category = '${cat}'" :class="category === '${cat}' ? 'is-active' : ''" class="chip" type="button">
            ${escapeHtml(CATEGORY_LABELS[cat])} <span class="count">${count}</span>
          </button>`,
          )
          .join('')}
      </div>

      <!-- LIST VIEW (default) -->
      <div x-show="view === 'list'" x-cloak class="overflow-x-auto" style="border:1px solid var(--rule);border-radius:12px;">
        <table class="ticker-table" id="ticker-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th class="right">Price</th>
              <th class="right">Fwd yield</th>
              <th class="right">5y CAGR</th>
              <th class="right">Streak</th>
              <th class="right">Safety</th>
              <th>Spark (TTM)</th>
            </tr>
          </thead>
          <tbody id="ticker-rows">
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <!-- GRID VIEW (toggle) -->
      <div x-show="view === 'grid'" x-cloak class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" id="ticker-grid">
        ${cardsHtml}
      </div>

      <p class="text-center text-[12px] muted py-6" x-show="visibleCount === 0" x-cloak>
        No tickers match your filters.
      </p>
    </section>
  </div>

  <style>[x-cloak]{display:none !important;}</style>

  <script>
    function dashboard() {
      return {
        search: '',
        kind: 'all',
        category: 'all',
        sortBy: 'ticker',
        view: 'list',
        visibleCount: ${totalCount},
        _rendered: false,
        init() {
          // restore view preference
          try {
            const saved = localStorage.getItem('dd_browse_view');
            if (saved === 'list' || saved === 'grid') this.view = saved;
          } catch(e){}
          this.$watch('search', () => this.applyFilters());
          this.$watch('kind', () => this.applyFilters());
          this.$watch('category', () => this.applyFilters());
          this.$watch('sortBy', () => this.applyFilters());
          this.$watch('view', (v) => {
            try { localStorage.setItem('dd_browse_view', v); } catch(e){}
            // render charts for whichever view is now visible
            this.$nextTick(() => this.renderCharts());
          });
          this.renderCharts();
        },
        applyFilters() {
          const search = this.search.toLowerCase();
          const apply = (sel, els) => {
            let visible = 0;
            const elArr = Array.from(els);
            for (const el of elArr) {
              const t = (el.dataset.ticker || '').toLowerCase();
              const n = (el.dataset.name || '').toLowerCase();
              const k = el.dataset.kind;
              const c = el.dataset.category;
              const matchSearch = !search || t.includes(search) || n.includes(search);
              const matchKind = this.kind === 'all' || k === this.kind;
              const matchCat = this.category === 'all' || c === this.category;
              const show = matchSearch && matchKind && matchCat;
              el.style.display = show ? '' : 'none';
              if (show) visible++;
            }
            const visibleEls = elArr.filter((el) => el.style.display !== 'none');
            visibleEls.sort((a, b) => {
              if (this.sortBy === 'ticker') return a.dataset.ticker.localeCompare(b.dataset.ticker);
              const av = parseFloat(a.dataset[this.sortBy]) || 0;
              const bv = parseFloat(b.dataset[this.sortBy]) || 0;
              return bv - av;
            });
            const parent = sel ? document.getElementById(sel) : null;
            if (parent) for (const el of visibleEls) parent.appendChild(el);
            return visible;
          };
          // run on both — they share the same dataset attrs and we
          // don't know which view is visible right now
          const v1 = apply('ticker-rows', document.querySelectorAll('#ticker-rows [data-ticker]'));
          apply('ticker-grid', document.querySelectorAll('#ticker-grid [data-ticker]'));
          this.visibleCount = v1;
        },
        renderCharts() {
          if (this._rendered) return;
          this._rendered = true;
          const t = window.__chartTheme();
          const D = window.__DASHBOARD__;
          if (!D) return;

          // -- Sparklines on table rows + cards --
          for (const [ticker, points] of Object.entries(D.sparkData)) {
            for (const id of ['rowspark-' + ticker, 'spark-' + ticker]) {
              const canvas = document.getElementById(id);
              if (!canvas || !points || points.length < 2) continue;
              new Chart(canvas, {
                type: 'line',
                data: {
                  labels: points.map((_, i) => i),
                  datasets: [{
                    data: points,
                    borderColor: t.emerald,
                    backgroundColor: t.emeraldFill,
                    borderWidth: 1.4, fill: true, tension: 0.32, pointRadius: 0,
                  }],
                },
                options: {
                  responsive: true, maintainAspectRatio: false,
                  plugins: { legend: { display: false }, tooltip: { enabled: false } },
                  scales: { x: { display: false }, y: { display: false } },
                  elements: { point: { radius: 0 } },
                  animation: false,
                },
              });
            }
          }

          // -- Outlook bars (13 weeks) --
          const out = document.getElementById('dd-outlook-bars');
          if (out) {
            new Chart(out, {
              type: 'bar',
              data: {
                labels: D.weeklyBuckets.map((w) => 'wk ' + (w.weekIndex + 1)),
                datasets: [{
                  data: D.weeklyBuckets.map((w) => w.estPerShare.toFixed(3)),
                  backgroundColor: t.emeraldFill,
                  borderColor: t.emerald,
                  borderWidth: 1.2,
                  borderRadius: 2,
                  maxBarThickness: 18,
                }],
              },
              options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: t.tooltipBg, titleColor: t.tooltipText,
                    bodyColor: t.tooltipBody, borderColor: t.tooltipBorder, borderWidth: 1,
                    padding: 8, cornerRadius: 6, displayColors: false,
                    callbacks: {
                      title: (items) => 'Week ' + (items[0].dataIndex + 1),
                      label: (ctx) => '$' + ctx.parsed.y + ' / share',
                    },
                  },
                },
                scales: {
                  x: { ticks: { color: t.text, font: { size: 9 }, autoSkip: true, maxRotation: 0 }, grid: { display: false }, border: { color: t.grid } },
                  y: { beginAtZero: true, ticks: { color: t.text, font: { size: 9 }, callback: (v) => '$' + v }, grid: { color: t.grid }, border: { display: false } },
                },
              },
            });
          }
        },
      };
    }
  </script>
  `;

  return renderLayout({
    title: 'Dashboard',
    active: 'dashboard',
    head,
    body,
    asOf,
  });
}

// ----- Leaderboard helper (no card border, just label + ranked rows) -----

function renderLeaderboard(
  title: string,
  rows: TickerCard[],
  metric: (c: TickerCard) => string,
  metricCls: string,
): string {
  if (rows.length === 0) {
    return `<div>
      <div class="label mb-3">${escapeHtml(title)}</div>
      <div class="text-[12px] muted italic">No data.</div>
    </div>`;
  }
  return `<div>
    <div class="label mb-3">${escapeHtml(title)}</div>
    <ol class="space-y-1 text-[13px]">
      ${rows
        .map((c, i) => {
          const showName = c.name && c.name.toUpperCase() !== c.ticker.toUpperCase();
          return `<li>
        <a href="/ticker/${escapeHtml(c.ticker)}" class="flex items-center gap-3 py-1.5 rounded-md hover:bg-[var(--surface-2)] px-1.5 -mx-1.5 transition-colors" style="text-decoration:none;color:inherit;">
          <span class="num text-[11px] faint w-4">${i + 1}</span>
          <span class="font-mono font-semibold ink w-14">${escapeHtml(c.ticker)}</span>
          ${showName ? `<span class="muted text-[12px] truncate flex-1" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>` : `<span class="muted text-[11px] truncate flex-1 capitalize">${escapeHtml(c.categoryLabel)}</span>`}
          <span class="num font-semibold ${metricCls}">${metric(c)}</span>
        </a>
      </li>`;
        })
        .join('')}
    </ol>
  </div>`;
}

// ----- Ticker row (default browse view) -----

function renderTickerRow(c: TickerCard, _history: { exDate: string; amount: number }[]): string {
  const yldCls = yieldColor(c.forwardYield);
  const fwd = c.forwardYield !== null ? fmtPct(c.forwardYield) : '—';
  const cagr = c.cagr5y !== null ? fmtPct(c.cagr5y, 1) : '—';
  const cagrCls = c.cagr5y === null ? 'muted' : c.cagr5y >= 0 ? 'positive' : 'negative';
  const grade = scoreToGrade(c.sustainability.total);
  const dataAttrs = [
    `data-ticker="${escapeHtml(c.ticker)}"`,
    `data-name="${escapeHtml(c.name)}"`,
    `data-kind="${c.kind}"`,
    `data-category="${c.category}"`,
    `data-forwardyield="${c.forwardYield ?? 0}"`,
    `data-sustainability="${c.sustainability.total}"`,
    `data-growthstreak="${c.growthStreak}"`,
    `data-cagr5y="${c.cagr5y ?? 0}"`,
  ].join(' ');
  const kindBadge =
    c.kind === 'etf'
      ? '<span class="pill pill-emerald">ETF</span>'
      : '<span class="pill pill-violet">STK</span>';

  return `
  <tr ${dataAttrs} onclick="window.location='/ticker/${escapeHtml(c.ticker)}'">
    <td class="ticker-cell">
      <div class="flex items-center gap-2">
        <span>${escapeHtml(c.ticker)}</span>
        ${kindBadge}
      </div>
    </td>
    <td class="name-cell">
      ${
        c.name && c.name.toUpperCase() !== c.ticker.toUpperCase()
          ? `<span class="name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span><span class="cat">${escapeHtml(c.categoryLabel)}</span>`
          : `<span class="name" title="${escapeHtml(c.categoryLabel)}">${escapeHtml(c.categoryLabel)}</span>`
      }
    </td>
    <td class="num-cell">${fmtUsd(c.priceCents)}</td>
    <td class="num-cell ${yldCls}">${fwd}</td>
    <td class="num-cell ${cagrCls}">${cagr}</td>
    <td class="num-cell">${c.growthStreak}<span class="muted text-[10px] ml-0.5">y</span></td>
    <td class="grade-cell"><span class="grade ${grade.cls}" title="Sustainability ${c.sustainability.total.toFixed(0)}/100">${grade.letter}</span></td>
    <td class="spark-cell"><canvas id="rowspark-${escapeHtml(c.ticker)}"></canvas></td>
  </tr>`;
}

// ----- Card (used in toggleable grid view) -----

function renderCard(c: TickerCard, _history: { exDate: string; amount: number }[]): string {
  const yldColorCls = yieldColor(c.forwardYield);
  const fwdYield = c.forwardYield !== null ? fmtPct(c.forwardYield) : '—';
  const cagr = c.cagr5y !== null ? fmtPct(c.cagr5y, 1) : '—';
  const cagrCls = c.cagr5y === null ? 'muted' : c.cagr5y >= 0 ? 'positive' : 'negative';
  const grade = scoreToGrade(c.sustainability.total);

  const dataAttrs = [
    `data-ticker="${escapeHtml(c.ticker)}"`,
    `data-name="${escapeHtml(c.name)}"`,
    `data-kind="${c.kind}"`,
    `data-category="${c.category}"`,
    `data-forwardyield="${c.forwardYield ?? 0}"`,
    `data-sustainability="${c.sustainability.total}"`,
    `data-growthstreak="${c.growthStreak}"`,
    `data-cagr5y="${c.cagr5y ?? 0}"`,
  ].join(' ');

  const kindBadge =
    c.kind === 'etf'
      ? '<span class="pill pill-emerald">ETF</span>'
      : '<span class="pill pill-violet">STK</span>';

  const showFundamentals = c.hasFundamentals && c.payoutRatio !== null;

  return `
  <a href="/ticker/${escapeHtml(c.ticker)}" class="ticker-card" ${dataAttrs}>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-mono font-semibold text-lg ink">${escapeHtml(c.ticker)}</span>
          ${kindBadge}
        </div>
        <div class="text-[12px] muted truncate mt-1" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="label mt-1" style="font-size:10px;">${escapeHtml(c.categoryLabel)}</div>
      </div>
      <div class="grade ${grade.cls}" title="Sustainability score ${c.sustainability.total.toFixed(0)}/100">${grade.letter}</div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div>
        <div class="label" style="font-size:10px;">Price</div>
        <div class="num font-semibold ink mt-1">${fmtUsd(c.priceCents)}</div>
      </div>
      <div>
        <div class="label" style="font-size:10px;">Fwd yield${c.hasSpecialDividends ? ' <span class="muted" title="Pays specials/supplementals — yield is regular cadence only">✦</span>' : ''}</div>
        <div class="num font-semibold ${yldColorCls} mt-1">${fwdYield}</div>
      </div>
      <div>
        <div class="label" style="font-size:10px;">5y CAGR</div>
        <div class="num font-semibold ${cagrCls} mt-1">${cagr}</div>
      </div>
      <div>
        <div class="label" style="font-size:10px;">Streak</div>
        <div class="num font-semibold ink mt-1">${c.growthStreak}<span class="text-xs muted ml-0.5">y</span></div>
      </div>
    </div>

    <div class="mt-4">
      <canvas id="spark-${escapeHtml(c.ticker)}" class="sparkline" height="28"></canvas>
    </div>

    <div class="mt-4 flex items-center justify-between text-[11px]" style="border-top:1px solid var(--rule);padding-top:10px;">
      ${
        showFundamentals
          ? `<span class="muted">Payout <span class="num ink-2 ml-0.5">${fmtPct(c.payoutRatio, 0)}</span></span>`
          : `<span class="faint italic">no fundamentals</span>`
      }
      <span class="muted capitalize">${c.frequency}</span>
    </div>

    ${
      c.sustainability.warnings.length > 0
        ? `<div class="mt-2 text-[10px] accent-2-text line-clamp-2" title="${escapeHtml(c.sustainability.warnings.join(' · '))}">⚠ ${escapeHtml(c.sustainability.warnings[0]!)}</div>`
        : ''
    }
  </a>`;
}
