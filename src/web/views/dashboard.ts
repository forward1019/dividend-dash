/**
 * Dashboard view (v0.5).
 *
 * Layout (top → bottom, "important info first"):
 *
 *   1. Hero KPI strip — tracked, avg yield, avg safety, dividend events.
 *   2. At-a-glance row — Universe Mix donut + Yield Distribution histogram +
 *      Frequency Mix mini-bars. (THREE charts that did not exist before.)
 *   3. Income Outlook — 30/60/90 day rollups + 13-week bar chart of
 *      projected per-share payouts.
 *   4. Leaderboards — Top Yield, Top 5y Growth, Longest Streak (mini lists).
 *   5. Filters + card grid (the existing browser, refined to the new
 *      design system).
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

  const cardsHtml = cards.map((c) => renderCard(c, history[c.ticker] ?? [])).join('\n');

  // Embed JSON for client charts (sector mix, yield histogram, weekly outlook)
  const head = `<script>window.__DASHBOARD__ = ${JSON.stringify({
    yieldHistogram: stats.yieldHistogram,
    sectorMix: stats.sectorMix.slice(0, 10), // cap legend
    frequencyMix: stats.frequencyMix,
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

  const body = /* html */ `
  <div x-data="dashboard()" x-init="init()" class="space-y-7">

    <!-- ============= HERO KPI STRIP ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Universe overview</span>
          <span class="text-[12px] muted">${totalCount} tickers tracked · ${stats.etfCount} ETFs · ${stats.stockCount} stocks</span>
        </div>
        <a href="/calendar" class="text-[12px] accent-text hover:underline">Income calendar →</a>
      </div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="kpi">
          <span class="label">Tracked tickers</span>
          <div class="value">${totalCount}</div>
          <div class="sub">${stats.totalDividendEvents.toLocaleString()} dividend events recorded</div>
        </div>
        <div class="kpi">
          <span class="label">Average forward yield</span>
          <div class="value accent-text">${fmtPct(stats.avgForwardYield, 2)}</div>
          <div class="sub">across ${cards.filter((c) => c.forwardYield !== null).length} priced names</div>
        </div>
        <div class="kpi">
          <span class="label">Average safety score</span>
          <div class="value">${stats.avgSustainability.toFixed(1)}<span class="text-base muted ml-1">/100</span></div>
          <div class="sub">avg payout ${fmtPct(stats.avgPayoutRatio, 0)} where measurable</div>
        </div>
        <div class="kpi">
          <span class="label">90-day income runway</span>
          <div class="value accent-2-text">${outlook.next90.estPerShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${outlook.next90.count} payments projected, ${outlook.next30.count} in 30d</div>
        </div>
      </div>
    </section>

    <!-- ============= UNIVERSE AT A GLANCE ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Universe at a glance</span>
          <span class="text-[12px] muted hidden md:inline">how the 40 names break down</span>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="label">Sector mix</span>
            <span class="text-[11px] muted">top 10</span>
          </div>
          <div class="relative" style="height:200px;">
            <canvas id="dd-sector-donut"></canvas>
          </div>
          <div id="dd-sector-legend" class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]"></div>
        </div>

        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="label">Forward yield distribution</span>
            <span class="text-[11px] muted">tickers per bucket</span>
          </div>
          <div class="relative" style="height:200px;">
            <canvas id="dd-yield-hist"></canvas>
          </div>
        </div>

        <div class="surface p-4">
          <div class="flex items-center justify-between mb-2">
            <span class="label">Payment frequency</span>
            <span class="text-[11px] muted">how often they pay</span>
          </div>
          <div class="space-y-2.5 mt-3">
            ${stats.frequencyMix
              .map((f) => {
                const pct = (f.pct * 100).toFixed(0);
                return `<div>
                <div class="flex items-baseline justify-between text-[12px]">
                  <span class="capitalize ink-3">${escapeHtml(f.frequency)}</span>
                  <span class="num muted">${f.count} · ${pct}%</span>
                </div>
                <div class="bar-track mt-1"><div class="bar-fill" style="width:${pct}%;"></div></div>
              </div>`;
              })
              .join('')}
          </div>
        </div>
      </div>
    </section>

    <!-- ============= INCOME OUTLOOK ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Income outlook (next 90 days)</span>
          <span class="text-[12px] muted hidden md:inline">projected ex-dividend payouts</span>
        </div>
        <a href="/calendar" class="text-[12px] accent-text hover:underline">Full calendar →</a>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="surface p-4 lg:col-span-2">
          <div class="grid grid-cols-3 gap-3 mb-4">
            <div>
              <div class="label">Next 30 days</div>
              <div class="num text-2xl ink mt-1">${outlook.next30.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11px] muted mt-0.5">${outlook.next30.count} payments</div>
            </div>
            <div>
              <div class="label">Next 60 days</div>
              <div class="num text-2xl ink mt-1">${outlook.next60.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11px] muted mt-0.5">${outlook.next60.count} payments</div>
            </div>
            <div>
              <div class="label">Next 90 days</div>
              <div class="num text-2xl accent-text mt-1">${outlook.next90.estPerShare.toFixed(2)}<span class="text-sm muted ml-1">$/sh</span></div>
              <div class="text-[11px] muted mt-0.5">${outlook.next90.count} payments</div>
            </div>
          </div>
          <div class="relative" style="height:120px;">
            <canvas id="dd-outlook-bars"></canvas>
          </div>
          <div class="text-[11px] muted mt-1 text-center">$/share grouped by week from today</div>
        </div>
        <div class="surface p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="label">Largest upcoming</span>
            <span class="text-[11px] muted">$/sh</span>
          </div>
          <div class="space-y-2">
            ${
              outlook.topUpcoming
                .map(
                  (
                    e,
                  ) => `<a href="/ticker/${escapeHtml(e.ticker)}" class="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[13px] hover:bg-[var(--surface-2)] transition-colors" style="text-decoration:none;color:inherit;">
                  <span class="font-mono font-semibold ink w-14">${escapeHtml(e.ticker)}</span>
                  <span class="text-[11px] muted flex-1 truncate">${escapeHtml(e.exDate)}</span>
                  <span class="num accent-text">$${e.amount.toFixed(3)}</span>
                </a>`,
                )
                .join('') ||
              '<div class="text-[12px] muted italic">No upcoming payments in the window.</div>'
            }
          </div>
        </div>
      </div>
    </section>

    <!-- ============= LEADERBOARDS ============= -->
    <section>
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Movers &amp; standouts</span>
          <span class="text-[12px] muted hidden md:inline">top 5 across the universe</span>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        ${renderLeaderboard('Top forward yield', leaderboards.topYield, (c) => fmtPct(c.forwardYield, 2), 'accent-2-text')}
        ${renderLeaderboard('Fastest 5y dividend growth', leaderboards.topGrowth, (c) => fmtPct(c.cagr5y, 1), 'positive')}
        ${renderLeaderboard('Longest growth streak', leaderboards.topStreak, (c) => `${c.growthStreak}y`, 'accent-text')}
      </div>
    </section>

    <!-- ============= FILTERS + GRID ============= -->
    <section class="space-y-4">
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Browse the universe</span>
          <span class="text-[12px] muted hidden md:inline">filter, sort, drill in</span>
        </div>
      </div>

      <div class="surface p-4">
        <div class="flex flex-wrap items-center gap-3 mb-3">
          <div class="relative flex-1 min-w-[200px]">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              x-model="search"
              placeholder="Filter by ticker or name…"
              class="input w-full pl-9"
              style="padding-top:8px;padding-bottom:8px;"
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
          <button @click="category = 'all'" :class="category === 'all' ? 'is-active' : ''" class="chip">
            All <span class="count">${totalCount}</span>
          </button>
          ${categoryEntries
            .map(
              ([cat, count]) =>
                `<button @click="category = '${cat}'" :class="category === '${cat}' ? 'is-active' : ''" class="chip">
              ${escapeHtml(CATEGORY_LABELS[cat])} <span class="count">${count}</span>
            </button>`,
            )
            .join('')}
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" id="ticker-grid">
        ${cardsHtml}
      </div>

      <p class="text-center text-[12px] muted" x-show="visibleCount === 0">
        No tickers match your filters.
      </p>
    </section>
  </div>

  <script>
    function dashboard() {
      return {
        search: '',
        kind: 'all',
        category: 'all',
        sortBy: 'ticker',
        visibleCount: ${totalCount},
        _rendered: false,
        init() {
          this.$watch('search', () => this.applyFilters());
          this.$watch('kind', () => this.applyFilters());
          this.$watch('category', () => this.applyFilters());
          this.$watch('sortBy', () => this.applyFilters());
          this.renderCharts();
        },
        applyFilters() {
          const grid = document.getElementById('ticker-grid');
          const cards = Array.from(grid.querySelectorAll('[data-ticker]'));
          let visible = 0;
          const search = this.search.toLowerCase();
          for (const el of cards) {
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
          this.visibleCount = visible;

          const visibleEls = cards.filter((el) => el.style.display !== 'none');
          visibleEls.sort((a, b) => {
            if (this.sortBy === 'ticker') return a.dataset.ticker.localeCompare(b.dataset.ticker);
            const av = parseFloat(a.dataset[this.sortBy]) || 0;
            const bv = parseFloat(b.dataset[this.sortBy]) || 0;
            return bv - av;
          });
          for (const el of visibleEls) grid.appendChild(el);
        },
        renderCharts() {
          if (this._rendered) return;
          this._rendered = true;
          const t = window.__chartTheme();
          const D = window.__DASHBOARD__;
          if (!D) return;

          // -- Sparklines on cards --
          for (const [ticker, points] of Object.entries(D.sparkData)) {
            const canvas = document.getElementById('spark-' + ticker);
            if (!canvas || !points || points.length < 2) continue;
            new Chart(canvas, {
              type: 'line',
              data: {
                labels: points.map((_, i) => i),
                datasets: [{
                  data: points,
                  borderColor: t.emerald,
                  backgroundColor: t.emeraldFill,
                  borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0,
                }],
              },
              options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } },
                elements: { point: { radius: 0 } },
              },
            });
          }

          // -- Sector donut --
          const donut = document.getElementById('dd-sector-donut');
          if (donut && D.sectorMix.length) {
            const labels = D.sectorMix.map((s) => s.sector);
            const counts = D.sectorMix.map((s) => s.count);
            new Chart(donut, {
              type: 'doughnut',
              data: {
                labels,
                datasets: [{
                  data: counts,
                  backgroundColor: t.sector.slice(0, labels.length),
                  borderColor: t.isLight ? '#ffffff' : '#0f131c',
                  borderWidth: 2,
                }],
              },
              options: {
                cutout: '62%',
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: t.tooltipBg, titleColor: t.tooltipText,
                    bodyColor: t.tooltipBody, borderColor: t.tooltipBorder, borderWidth: 1,
                    callbacks: {
                      label: (ctx) => ctx.label + ': ' + ctx.parsed + ' (' + ((ctx.parsed / counts.reduce((a,b)=>a+b,0)) * 100).toFixed(0) + '%)'
                    },
                  },
                },
              },
            });
            // Build legend
            const legendEl = document.getElementById('dd-sector-legend');
            if (legendEl) {
              legendEl.innerHTML = labels.map((label, i) =>
                '<div class="flex items-center gap-2 truncate">' +
                  '<span style="width:8px;height:8px;border-radius:2px;background:' + t.sector[i % t.sector.length] + ';flex:none;"></span>' +
                  '<span class="ink-3 truncate" title="' + label + '">' + label + '</span>' +
                  '<span class="num muted ml-auto">' + counts[i] + '</span>' +
                '</div>'
              ).join('');
            }
          }

          // -- Yield histogram --
          const hist = document.getElementById('dd-yield-hist');
          if (hist) {
            new Chart(hist, {
              type: 'bar',
              data: {
                labels: D.yieldHistogram.map((b) => b.label),
                datasets: [{
                  data: D.yieldHistogram.map((b) => b.count),
                  backgroundColor: D.yieldHistogram.map((b) => {
                    if (b.min >= 0.08) return t.rose;
                    if (b.min >= 0.05) return t.amber;
                    if (b.min >= 0.03) return t.emerald;
                    return t.cyan;
                  }),
                  borderWidth: 0,
                  borderRadius: 4,
                  maxBarThickness: 36,
                }],
              },
              options: {
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: t.tooltipBg, titleColor: t.tooltipText,
                    bodyColor: t.tooltipBody, borderColor: t.tooltipBorder, borderWidth: 1,
                    callbacks: { label: (ctx) => ctx.parsed.y + ' tickers' },
                  },
                },
                scales: {
                  x: { ticks: { color: t.text, font: { size: 10 } }, grid: { display: false } },
                  y: { beginAtZero: true, ticks: { color: t.text, font: { size: 10 }, stepSize: 2 }, grid: { color: t.grid } },
                },
              },
            });
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
                  borderWidth: 1.5,
                  borderRadius: 3,
                  maxBarThickness: 22,
                }],
              },
              options: {
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: t.tooltipBg, titleColor: t.tooltipText,
                    bodyColor: t.tooltipBody, borderColor: t.tooltipBorder, borderWidth: 1,
                    callbacks: {
                      title: (items) => 'Week ' + (items[0].dataIndex + 1),
                      label: (ctx) => '$' + ctx.parsed.y + ' / share',
                    },
                  },
                },
                scales: {
                  x: { ticks: { color: t.text, font: { size: 9 }, autoSkip: false }, grid: { display: false } },
                  y: { beginAtZero: true, ticks: { color: t.text, font: { size: 10 }, callback: (v) => '$' + v }, grid: { color: t.grid } },
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

// ----- Leaderboard helper -----

function renderLeaderboard(
  title: string,
  rows: TickerCard[],
  metric: (c: TickerCard) => string,
  metricCls: string,
): string {
  if (rows.length === 0) {
    return `<div class="surface p-4">
      <div class="label mb-2">${escapeHtml(title)}</div>
      <div class="text-[12px] muted italic">No data.</div>
    </div>`;
  }
  return `<div class="surface p-4">
    <div class="label mb-2">${escapeHtml(title)}</div>
    <ol class="space-y-1.5 text-[13px]">
      ${rows
        .map(
          (c, i) => `<li>
        <a href="/ticker/${escapeHtml(c.ticker)}" class="flex items-center gap-2 px-1 py-1 rounded-md hover:bg-[var(--surface-2)] transition-colors" style="text-decoration:none;color:inherit;">
          <span class="num text-[11px] muted w-4">${i + 1}.</span>
          <span class="font-mono font-semibold ink w-14">${escapeHtml(c.ticker)}</span>
          <span class="muted text-[12px] truncate flex-1" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>
          <span class="num font-semibold ${metricCls}">${metric(c)}</span>
        </a>
      </li>`,
        )
        .join('')}
    </ol>
  </div>`;
}

// ----- Card -----

function renderCard(c: TickerCard, _history: { exDate: string; amount: number }[]): string {
  const yldColor = yieldColor(c.forwardYield);
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
      ? '<span class="pill pill-cyan">ETF</span>'
      : '<span class="pill pill-violet">STOCK</span>';

  const showFundamentals = c.hasFundamentals && c.payoutRatio !== null;

  return `
  <a href="/ticker/${escapeHtml(c.ticker)}" class="ticker-card" ${dataAttrs}>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-mono font-semibold text-lg ink">${escapeHtml(c.ticker)}</span>
          ${kindBadge}
        </div>
        <div class="text-[12px] muted truncate mt-0.5" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="label mt-0.5 text-[10px]">${escapeHtml(c.categoryLabel)}</div>
      </div>
      <div class="grade ${grade.cls}" title="Sustainability score ${c.sustainability.total.toFixed(0)}/100">${grade.letter}</div>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2.5 text-sm">
      <div>
        <div class="label text-[10px]">Price</div>
        <div class="num font-semibold ink">${fmtUsd(c.priceCents)}</div>
      </div>
      <div>
        <div class="label text-[10px]">Forward yield</div>
        <div class="num font-semibold ${yldColor}">${fwdYield}</div>
      </div>
      <div>
        <div class="label text-[10px]">5y CAGR</div>
        <div class="num font-semibold ${cagrCls}">${cagr}</div>
      </div>
      <div>
        <div class="label text-[10px]">Streak</div>
        <div class="num font-semibold ink">${c.growthStreak}<span class="text-xs muted ml-0.5">y</span></div>
      </div>
    </div>

    <div class="mt-3">
      <canvas id="spark-${escapeHtml(c.ticker)}" class="sparkline" height="28"></canvas>
    </div>

    <div class="mt-3 flex items-center justify-between text-[11px]" style="border-top:1px solid var(--rule);padding-top:9px;">
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
