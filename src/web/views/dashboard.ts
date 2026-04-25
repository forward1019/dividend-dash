/**
 * Dashboard view — single-page overview of all 40 tracked tickers.
 *
 * Hero: portfolio-style top-line stats (universe count, average yield,
 * average sustainability score, growth-streak champ).
 *
 * Below: searchable, sortable, filter-by-category grid of ticker cards.
 * Each card shows price, forward yield, growth streak, sustainability
 * score, and a sparkline of dividend history. Click any card to drill in.
 */

import type { TickerCard } from '../data.ts';
import { CATEGORY_LABELS, type UniverseCategory } from '../tickers.ts';
import { escapeHtml, fmtPct, fmtUsd, renderLayout, scoreColor, yieldColor } from './layout.ts';

interface DashboardData {
  cards: TickerCard[];
  history: Record<string, { exDate: string; amount: number }[]>;
}

export function renderDashboard(data: DashboardData): string {
  const cards = data.cards;
  const totalCount = cards.length;

  const yields = cards.map((c) => c.forwardYield).filter((y): y is number => y !== null && y > 0);
  const avgYield = yields.length > 0 ? yields.reduce((a, b) => a + b, 0) / yields.length : 0;
  const sustScores = cards.map((c) => c.sustainability.total);
  const avgSust =
    sustScores.length > 0 ? sustScores.reduce((a, b) => a + b, 0) / sustScores.length : 0;

  const champ = cards
    .filter((c) => c.kind === 'stock')
    .reduce<TickerCard | null>((best, c) => {
      if (!best) return c;
      return c.growthStreak > best.growthStreak ? c : best;
    }, null);

  const yieldChamp = cards.reduce<TickerCard | null>((best, c) => {
    if (c.forwardYield === null) return best;
    if (!best || best.forwardYield === null) return c;
    return c.forwardYield > best.forwardYield ? c : best;
  }, null);

  const totalDivs = cards.reduce((acc, c) => acc + (data.history[c.ticker]?.length ?? 0), 0);

  // Categories present in this universe, with counts
  const categoryCounts = cards.reduce<Record<UniverseCategory, number>>(
    (acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    },
    {} as Record<UniverseCategory, number>,
  );
  const categoryEntries = Object.entries(categoryCounts) as [UniverseCategory, number][];
  categoryEntries.sort((a, b) => b[1] - a[1]);

  const cardsHtml = cards.map((c) => renderCard(c, data.history[c.ticker] ?? [])).join('\n');

  const head = `<script>window.__DASHBOARD__ = ${JSON.stringify({
    cards: cards.map((c) => ({
      ticker: c.ticker,
      name: c.name,
      category: c.category,
      categoryLabel: c.categoryLabel,
      kind: c.kind,
      forwardYield: c.forwardYield,
      sustainability: c.sustainability.total,
      growthStreak: c.growthStreak,
      cagr5y: c.cagr5y,
      priceCents: c.priceCents,
      ttmDps: c.ttmDps,
    })),
  })};</script>`;

  const body = /* html */ `
  <div x-data="dashboard()" x-init="init()" class="space-y-8">

    <!-- Hero stats -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="glass rounded-2xl p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400">Tracked tickers</div>
        <div class="num text-3xl font-bold text-emerald-400 mt-1">${totalCount}</div>
        <div class="text-xs text-slate-500 mt-1">${totalDivs.toLocaleString()} dividend events</div>
      </div>
      <div class="glass rounded-2xl p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400">Avg forward yield</div>
        <div class="num text-3xl font-bold text-cyan-400 mt-1">${fmtPct(avgYield, 2)}</div>
        <div class="text-xs text-slate-500 mt-1">across ${yields.length} priced names</div>
      </div>
      <div class="glass rounded-2xl p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400">Avg sustainability</div>
        <div class="num text-3xl font-bold ${scoreColor(avgSust)} mt-1">${avgSust.toFixed(1)}</div>
        <div class="text-xs text-slate-500 mt-1">/ 100 score</div>
      </div>
      <div class="glass rounded-2xl p-5">
        <div class="text-xs uppercase tracking-wider text-slate-400">Highlights</div>
        <div class="text-sm mt-2 space-y-1">
          ${
            yieldChamp
              ? `<div>🔥 Top yield: <a href="/ticker/${yieldChamp.ticker}" class="text-amber-400 font-semibold hover:underline">${yieldChamp.ticker}</a> ${fmtPct(yieldChamp.forwardYield)}</div>`
              : ''
          }
          ${
            champ
              ? `<div>👑 Streak: <a href="/ticker/${champ.ticker}" class="text-emerald-400 font-semibold hover:underline">${champ.ticker}</a> ${champ.growthStreak}y</div>`
              : ''
          }
        </div>
      </div>
    </section>

    <!-- Filters -->
    <section class="glass rounded-2xl p-5">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="relative flex-1 min-w-[200px]">
          <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            x-model="search"
            placeholder="Search by ticker or name…"
            class="w-full bg-slate-900/60 border border-slate-700 rounded-lg pl-10 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-slate-500"
          >
        </div>
        <select x-model="kind" class="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
          <option value="all">All kinds</option>
          <option value="etf">ETFs only</option>
          <option value="stock">Stocks only</option>
        </select>
        <select x-model="sortBy" class="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500">
          <option value="ticker">Sort: A–Z</option>
          <option value="forwardYield">Sort: forward yield ↓</option>
          <option value="sustainability">Sort: safety ↓</option>
          <option value="growthStreak">Sort: growth streak ↓</option>
          <option value="cagr5y">Sort: 5y CAGR ↓</option>
        </select>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          @click="category = 'all'"
          :class="category === 'all' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700'"
          class="text-xs px-3 py-1 rounded-full border transition-colors"
        >All <span class="opacity-60">${totalCount}</span></button>
        ${categoryEntries
          .map(
            ([cat, count]) =>
              `<button
            @click="category = '${cat}'"
            :class="category === '${cat}' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800/60 text-slate-400 border-slate-700'"
            class="text-xs px-3 py-1 rounded-full border transition-colors"
          >${escapeHtml(CATEGORY_LABELS[cat])} <span class="opacity-60">${count}</span></button>`,
          )
          .join('')}
      </div>
    </section>

    <!-- Card grid -->
    <section
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
      id="ticker-grid"
    >
      ${cardsHtml}
    </section>

    <p class="text-center text-xs text-slate-500" x-show="visibleCount === 0">
      No tickers match your filters.
    </p>
  </div>

  <script>
    function dashboard() {
      return {
        search: '',
        kind: 'all',
        category: 'all',
        sortBy: 'ticker',
        visibleCount: ${totalCount},
        _sparklinesRendered: false,
        init() {
          this.$watch('search', () => this.applyFilters());
          this.$watch('kind', () => this.applyFilters());
          this.$watch('category', () => this.applyFilters());
          this.$watch('sortBy', () => this.applyFilters());
          // Render sparklines once on mount (Alpine sometimes re-runs init
          // after async script loads, so guard against double-attaching
          // Chart.js to the same canvas).
          this.renderSparklines();
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

          // Sort
          const visibleEls = cards.filter((el) => el.style.display !== 'none');
          const direction = this.sortBy === 'ticker' ? 1 : -1;
          visibleEls.sort((a, b) => {
            const av = parseFloat(a.dataset[this.sortBy]) || 0;
            const bv = parseFloat(b.dataset[this.sortBy]) || 0;
            if (this.sortBy === 'ticker') {
              return a.dataset.ticker.localeCompare(b.dataset.ticker);
            }
            return (bv - av) * (direction > 0 ? 1 : -1);
          });
          for (const el of visibleEls) grid.appendChild(el);
        },
        renderSparklines() {
          if (this._sparklinesRendered) return;
          this._sparklinesRendered = true;
          const sparkData = ${JSON.stringify(
            Object.fromEntries(
              Object.entries(data.history).map(([t, h]) => [t, h.slice(-20).map((p) => p.amount)]),
            ),
          )};
          const t = window.__chartTheme();
          for (const [ticker, points] of Object.entries(sparkData)) {
            const canvas = document.getElementById('spark-' + ticker);
            if (!canvas || points.length < 2) continue;
            new Chart(canvas, {
              type: 'line',
              data: {
                labels: points.map((_, i) => i),
                datasets: [{
                  data: points,
                  borderColor: t.emerald,
                  backgroundColor: t.isLight ? 'rgba(5, 150, 105, 0.10)' : 'rgba(52, 211, 153, 0.10)',
                  borderWidth: 1.5,
                  fill: true,
                  tension: 0.3,
                  pointRadius: 0,
                }],
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                scales: { x: { display: false }, y: { display: false } },
                elements: { point: { radius: 0 } },
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
  });
}

function renderCard(c: TickerCard, history: { exDate: string; amount: number }[]): string {
  const sustColor = scoreColor(c.sustainability.total);
  const yldColor = yieldColor(c.forwardYield);
  const fwdYield = c.forwardYield !== null ? fmtPct(c.forwardYield) : '—';
  const cagr = c.cagr5y !== null ? fmtPct(c.cagr5y, 1) : '—';
  const cagrColor =
    c.cagr5y === null ? 'text-slate-400' : c.cagr5y >= 0 ? 'text-emerald-400' : 'text-rose-400';

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
      ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono">ETF</span>'
      : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono">STOCK</span>';

  const showFundamentals = c.hasFundamentals && c.payoutRatio !== null;
  const payoutLine = showFundamentals
    ? `<span class="text-slate-400">Payout</span> <span class="num text-slate-200">${fmtPct(c.payoutRatio, 0)}</span>`
    : `<span class="text-slate-500 italic text-[11px]">no fundamentals</span>`;

  return `
  <a href="/ticker/${escapeHtml(c.ticker)}" class="ticker-card glass rounded-2xl p-4 block border border-slate-800/60 hover:border-emerald-500/40" ${dataAttrs}>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-bold text-lg text-slate-50 font-mono tracking-tight">${escapeHtml(c.ticker)}</span>
          ${kindBadge}
        </div>
        <div class="text-[11px] text-slate-400 truncate mt-0.5" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">${escapeHtml(c.categoryLabel)}</div>
      </div>
      <div class="score-badge ${sustColor} shrink-0" title="Sustainability score">
        <span class="num">${c.sustainability.total.toFixed(0)}</span>
      </div>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
      <div>
        <div class="text-[10px] text-slate-500 uppercase tracking-wider">Price</div>
        <div class="num font-semibold text-slate-100">${fmtUsd(c.priceCents)}</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-500 uppercase tracking-wider">Forward yield</div>
        <div class="num font-semibold ${yldColor}">${fwdYield}</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-500 uppercase tracking-wider">5y CAGR</div>
        <div class="num font-semibold ${cagrColor}">${cagr}</div>
      </div>
      <div>
        <div class="text-[10px] text-slate-500 uppercase tracking-wider">Streak</div>
        <div class="num font-semibold text-slate-100">${c.growthStreak}<span class="text-xs text-slate-500"> yr</span></div>
      </div>
    </div>

    <div class="mt-3">
      <canvas id="spark-${escapeHtml(c.ticker)}" class="sparkline" height="32"></canvas>
    </div>

    <div class="mt-3 flex items-center justify-between text-[11px] border-t border-slate-800/60 pt-3">
      ${payoutLine}
      <span class="text-slate-500 capitalize">${c.frequency}</span>
    </div>

    ${
      c.sustainability.warnings.length > 0
        ? `<div class="mt-2 text-[10px] text-amber-300/90 line-clamp-2" title="${escapeHtml(c.sustainability.warnings.join(' · '))}">⚠ ${escapeHtml(c.sustainability.warnings[0]!)}</div>`
        : ''
    }
  </a>`;
}
