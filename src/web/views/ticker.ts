/**
 * Per-ticker page (v0.5).
 *
 * Layout — important first, drill-downs below.
 *
 *   1. Quote hero
 *      - Symbol (display serif), name + exchange/sector subtitle
 *      - Big price + change/change% delta + 52w range bar
 *      - Mini TTM-DPS sparkline strip across the bottom
 *
 *   2. Quick Take — 4-card KPI strip
 *      - Forward yield · 5y CAGR · Payout ratio · Safety grade
 *
 *   3. Anchor ribbon (sticky nav for the page sections):
 *      - Dividends | Fundamentals | Holdings (etf only) | News
 *
 *   4. Income simulator
 *      - "$10,000 → $X/year today, $Y/year in 10 years (assumes 5y CAGR)"
 *
 *   5. Dividends section: annualized DPS bar chart, sustainability
 *      breakdown, per-payment chart + recent payments table, TTM area.
 *
 *   6. Fundamentals section: rich metric grid (12-18 cards).
 *
 *   7. Holdings section (ETF only): top-10 list + sector donut.
 *
 *   8. News section: cards with freshness dots.
 *
 *   9. About — collapsed company / fund description.
 */

import type {
  DividendHistoryPoint,
  EtfHoldingRow,
  EtfProfileRow,
  NewsRow,
  QuoteSnapshotRow,
  TickerCard,
} from '../data.ts';
import {
  escapeHtml,
  fmtCompactUsd,
  fmtNum,
  fmtPct,
  fmtUsd,
  renderDelta,
  renderLayout,
  scoreToGrade,
  yieldColor,
} from './layout.ts';

interface TickerPageData {
  card: TickerCard;
  history: DividendHistoryPoint[];
  cagr1y: number | null;
  cagr3y: number | null;
  snapshot: QuoteSnapshotRow | null;
  holdings: EtfHoldingRow[];
  etfProfile: EtfProfileRow | null;
  news: NewsRow[];
}

export function renderTickerPage(data: TickerPageData): string {
  const c = data.card;
  const h = data.history;
  const snap = data.snapshot;
  const isEtf = c.kind === 'etf';

  // === Derived chart data ===
  const cumulative = computeTtmSeries(h);
  const annualMap = new Map<number, number>();
  for (const p of h) {
    const yr = Number.parseInt(p.exDate.slice(0, 4), 10);
    annualMap.set(yr, (annualMap.get(yr) ?? 0) + p.amount);
  }
  const annualSeries = Array.from(annualMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, total]) => ({ year, total }));

  const recentPayments = [...h].slice(-12).reverse();

  // === Sustainability components ===
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

  const grade = scoreToGrade(c.sustainability.total);

  // === 52-week range ===
  const fiftyTwoHi = snap?.fiftyTwoWeekHigh ?? null;
  const fiftyTwoLo = snap?.fiftyTwoWeekLow ?? null;
  const currPrice = snap?.price ?? (c.priceCents !== null ? c.priceCents / 100 : null);
  const fiftyTwoBar = (() => {
    if (fiftyTwoHi === null || fiftyTwoLo === null || currPrice === null) return '';
    if (fiftyTwoHi <= fiftyTwoLo) return '';
    const pos = ((currPrice - fiftyTwoLo) / (fiftyTwoHi - fiftyTwoLo)) * 100;
    const clamped = Math.max(0, Math.min(100, pos));
    return /* html */ `
      <div class="mt-3">
        <div class="flex items-center justify-between text-[10.5px] muted mb-1">
          <span><span class="num ink-3">$${fiftyTwoLo.toFixed(2)}</span> 52w low</span>
          <span class="muted">52w range</span>
          <span>52w high <span class="num ink-3">$${fiftyTwoHi.toFixed(2)}</span></span>
        </div>
        <div class="range-bar">
          <div class="range-marker" style="left:${clamped.toFixed(1)}%"></div>
        </div>
      </div>
    `;
  })();

  // === Hero subtitle ===
  const subtitleParts: string[] = [];
  if (snap?.exchange) subtitleParts.push(escapeHtml(snap.exchange));
  if (snap?.sector) subtitleParts.push(escapeHtml(snap.sector));
  if (snap?.industry) subtitleParts.push(escapeHtml(snap.industry));
  if (subtitleParts.length === 0 && snap?.fundFamily)
    subtitleParts.push(escapeHtml(snap.fundFamily));
  const subtitleHtml = subtitleParts.join(' <span class="faint">·</span> ');

  // === Embed chart payloads ===
  const sectorWeights = data.etfProfile?.sectorWeights ?? [];
  const head = `<script>
    window.__TICKER__ = ${JSON.stringify({
      ticker: c.ticker,
      history: h,
      cumulative,
      annualSeries,
      sectorWeights,
      forwardYield: c.forwardYield,
      cagr5y: c.cagr5y,
      ttmDps: c.ttmDps,
      priceDollars: currPrice,
    })};
  </script>`;

  // === Quick-Take grade chip ===
  const yldColor = yieldColor(c.forwardYield);
  const cagrCls = c.cagr5y === null ? 'muted' : c.cagr5y >= 0 ? 'positive' : 'negative';

  const fundamentalsCards = isEtf
    ? buildEtfFundamentalsCards(snap)
    : buildStockFundamentalsCards(snap);

  const anchorRibbon = /* html */ `
    <nav class="anchor-ribbon">
      <a href="#dividends" class="is-active">Dividends</a>
      ${fundamentalsCards.length > 0 ? '<a href="#fundamentals">Fundamentals</a>' : ''}
      ${isEtf && data.holdings.length > 0 ? '<a href="#holdings">Holdings</a>' : ''}
      <a href="#income">Income simulator</a>
      ${data.news.length > 0 ? '<a href="#news">News</a>' : ''}
      ${snap?.summary ? '<a href="#about">About</a>' : ''}
    </nav>
  `;

  const body = /* html */ `
  <div class="space-y-6">
    <!-- Breadcrumb -->
    <nav class="text-[12px] muted flex items-center gap-1.5">
      <a href="/" class="hover:underline" style="color:inherit;">Dashboard</a>
      <span>/</span>
      <span class="ink-3">${escapeHtml(c.ticker)}</span>
    </nav>

    <!-- ============= QUOTE HERO ============= -->
    <section class="hero-quote">
      <div class="min-w-0">
        <div class="flex items-center gap-3 flex-wrap">
          <h1 class="symbol">${escapeHtml(c.ticker)}</h1>
          ${
            isEtf
              ? '<span class="pill pill-cyan">ETF</span>'
              : '<span class="pill pill-violet">STOCK</span>'
          }
          <span class="pill pill-slate">${escapeHtml(c.categoryLabel)}</span>
          ${
            c.frequency
              ? `<span class="pill pill-amber">${escapeHtml(c.frequency.toUpperCase())}</span>`
              : ''
          }
        </div>
        <p class="mt-2 ink-2 text-[15px] font-medium">${escapeHtml(c.name)}</p>
        ${subtitleHtml ? `<p class="text-[12px] muted mt-1">${subtitleHtml}</p>` : ''}
        ${c.notes ? `<p class="text-[12.5px] faint italic mt-1">${escapeHtml(c.notes)}</p>` : ''}
        ${fiftyTwoBar}
      </div>
      <div class="flex flex-col items-end">
        <span class="label">Last close ${c.priceAsOf ? `· <span class="num">${escapeHtml(c.priceAsOf)}</span>` : ''}</span>
        <div class="price">${fmtUsd(c.priceCents)}</div>
        ${
          snap?.fiftyTwoWeekChangePct !== null && snap?.fiftyTwoWeekChangePct !== undefined
            ? `<div class="mt-1.5">${renderDelta(snap.fiftyTwoWeekChangePct, { suffix: '%', decimals: 2 })} <span class="text-[11px] muted ml-1">52w total return</span></div>`
            : ''
        }
      </div>
    </section>

    <!-- ============= QUICK TAKE ============= -->
    <section>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="kpi">
          <span class="label">Forward yield</span>
          <div class="value ${yldColor}">${fmtPct(c.forwardYield, 2)}${c.hasSpecialDividends ? ' <span class="text-[10px] muted ml-1" title="Forward yield is computed from regular dividends only — specials/supplementals are excluded">✦ excl. specials</span>' : ''}</div>
          <div class="sub">${
            c.ttmDps !== null
              ? c.hasSpecialDividends && c.ttmDpsRegular !== null && c.ttmDpsRegular !== c.ttmDps
                ? `TTM DPS $${c.ttmDpsRegular.toFixed(2)} regular / $${c.ttmDps.toFixed(2)} total`
                : `TTM DPS $${c.ttmDps.toFixed(2)}`
              : '—'
          }</div>
        </div>
        <div class="kpi">
          <span class="label">5y dividend CAGR</span>
          <div class="value ${cagrCls}">${fmtPct(c.cagr5y, 1)}</div>
          <div class="sub">3y ${fmtPct(data.cagr3y, 1)} · 1y ${fmtPct(data.cagr1y, 1)}</div>
        </div>
        <div class="kpi">
          <span class="label">${isEtf ? 'Expense ratio' : 'Payout ratio'}</span>
          <div class="value">${
            isEtf
              ? snap?.expenseRatio !== null && snap?.expenseRatio !== undefined
                ? fmtPct(snap.expenseRatio, 2)
                : '—'
              : c.payoutRatio !== null
                ? fmtPct(c.payoutRatio, 0)
                : '—'
          }</div>
          <div class="sub">${
            isEtf
              ? snap?.totalAssets !== null && snap?.totalAssets !== undefined
                ? `AUM ${fmtCompactUsd(snap.totalAssets, 1)}`
                : ''
              : c.fcfPayoutRatio !== null
                ? `FCF cover ${fmtPct(c.fcfPayoutRatio, 0)}`
                : 'no fundamentals'
          }</div>
        </div>
        <div class="kpi">
          <span class="label">Sustainability</span>
          <div class="flex items-center gap-3 mt-1">
            <span class="grade ${grade.cls} grade-lg">${grade.letter}</span>
            <div>
              <div class="num text-2xl ink leading-none">${c.sustainability.total.toFixed(0)}</div>
              <div class="text-[11px] muted">/ 100 score</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    ${anchorRibbon}

    <!-- ============= DIVIDENDS ============= -->
    <section id="dividends" class="anchor-target space-y-4">
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Dividend history</span>
          <span class="text-[12px] muted hidden md:inline">${h.length} payments since ${h.length > 0 ? h[0]!.exDate : '—'}</span>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="surface p-4 lg:col-span-2">
          <div class="flex items-baseline justify-between mb-2">
            <h3 class="editorial text-base ink">Annualized dividends per share</h3>
            <span class="text-[11px] muted">calendar year</span>
          </div>
          <div class="relative" style="height:280px;">
            <canvas id="annualChart"></canvas>
          </div>
        </div>
        <div class="surface p-4">
          <div class="flex items-baseline justify-between mb-2">
            <h3 class="editorial text-base ink">Sustainability breakdown</h3>
            <span class="num text-[11px] muted">${c.sustainability.total.toFixed(0)} total</span>
          </div>
          <div class="space-y-3 mt-2">
            ${sustItems
              .map(
                (i) => `
              <div>
                <div class="flex justify-between items-baseline">
                  <span class="text-[12.5px] ink-3">${i.name}</span>
                  <span class="num text-[12.5px] ink">${i.score.toFixed(0)} <span class="muted text-[11px]">× ${(i.weight * 100).toFixed(0)}%</span></span>
                </div>
                <div class="h-1.5 mt-1 bar-track overflow-hidden">
                  <div class="h-full" style="width:${Math.max(i.score, 4)}%; background:linear-gradient(to right, var(--negative), var(--accent-2), var(--positive));"></div>
                </div>
              </div>`,
              )
              .join('')}
          </div>
          ${
            c.sustainability.warnings.length > 0
              ? `<div class="mt-4 pt-3" style="border-top:1px solid var(--rule);">
                  <div class="label accent-2-text mb-1">Warnings</div>
                  <ul class="text-[11.5px] ink-3 space-y-0.5">
                    ${c.sustainability.warnings.map((w) => `<li>⚠ ${escapeHtml(w)}</li>`).join('')}
                  </ul>
                </div>`
              : `<div class="mt-4 pt-3 text-[11.5px] positive" style="border-top:1px solid var(--rule);">✓ No structural warnings detected.</div>`
          }
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div class="surface p-4 lg:col-span-2">
          <div class="flex items-baseline justify-between mb-2">
            <h3 class="editorial text-base ink">Per-payment dividend history</h3>
            <span class="text-[11px] muted">each point = one ex-date</span>
          </div>
          <div class="relative" style="height:240px;">
            <canvas id="historyChart"></canvas>
          </div>
        </div>
        <div class="surface p-4">
          <div class="flex items-baseline justify-between mb-2">
            <h3 class="editorial text-base ink">Recent payments</h3>
            <span class="text-[11px] muted">last 12</span>
          </div>
          <table class="data-table">
            <thead><tr><th>Ex-date</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
              ${
                recentPayments.length > 0
                  ? recentPayments
                      .map(
                        (p) =>
                          `<tr><td class="num">${escapeHtml(p.exDate)}</td><td class="num-cell">$${p.amount.toFixed(4)}</td></tr>`,
                      )
                      .join('')
                  : '<tr><td colspan="2" class="text-center muted italic py-4">No history</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>

      <div class="surface p-4">
        <div class="flex items-baseline justify-between mb-2">
          <h3 class="editorial text-base ink">Trailing-12-month dividend per share</h3>
          <span class="text-[11px] muted">smoothed view of the income stream</span>
        </div>
        <div class="relative" style="height:260px;">
          <canvas id="ttmChart"></canvas>
        </div>
      </div>
    </section>

    ${
      fundamentalsCards.length > 0
        ? /* html */ `
    <!-- ============= FUNDAMENTALS ============= -->
    <section id="fundamentals" class="anchor-target space-y-3">
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">${isEtf ? 'Fund metrics' : 'Fundamentals'}</span>
          <span class="text-[12px] muted hidden md:inline">${
            isEtf
              ? 'AUM, expense, returns from the latest snapshot'
              : 'Valuation, balance sheet, profitability'
          }</span>
        </div>
        ${snap?.fetchDate ? `<span class="text-[11px] muted">as of <span class="num">${escapeHtml(snap.fetchDate)}</span></span>` : ''}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        ${fundamentalsCards.join('\n')}
      </div>
    </section>
    `
        : ''
    }

    ${isEtf && (data.holdings.length > 0 || sectorWeights.length > 0) ? renderEtfHoldings(data.holdings, data.etfProfile) : ''}

    <!-- ============= INCOME SIMULATOR ============= -->
    <section id="income" class="anchor-target">
      <div class="section-h">
        <div class="flex items-baseline gap-3">
          <span class="label">Income simulator</span>
          <span class="text-[12px] muted hidden md:inline">what would $X invested produce?</span>
        </div>
      </div>
      ${renderIncomeSimulator(c, currPrice)}
    </section>

    ${data.news.length > 0 ? renderNewsList(data.news) : ''}

    ${snap?.summary ? renderSummary(snap.summary, snap.website ?? null, isEtf ? 'About the fund' : 'About the company') : ''}
  </div>

  <script>
    (function() {
      const data = window.__TICKER__;
      const t = window.__chartTheme();
      const fmtUsd4 = (n) => '$' + n.toFixed(4);
      const fmtUsd2 = (n) => '$' + n.toFixed(2);

      const tooltipDefaults = {
        backgroundColor: t.tooltipBg, titleColor: t.tooltipText,
        bodyColor: t.tooltipBody, borderColor: t.tooltipBorder, borderWidth: 1,
        padding: 10, cornerRadius: 6, displayColors: false,
        titleFont: { size: 12, weight: '600' }, bodyFont: { size: 12 },
      };
      const axis = (extra) => Object.assign({
        grid: { color: t.grid },
        ticks: { color: t.text, font: { size: 11 } },
      }, extra || {});

      // Annualized DPS
      if (document.getElementById('annualChart')) {
        new Chart(document.getElementById('annualChart'), {
          type: 'bar',
          data: {
            labels: data.annualSeries.map((p) => p.year),
            datasets: [{
              label: 'Annual DPS',
              data: data.annualSeries.map((p) => p.total),
              backgroundColor: t.emeraldFill,
              borderColor: t.emerald,
              borderWidth: 1.5,
              borderRadius: 4,
              maxBarThickness: 28,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: Object.assign({}, tooltipDefaults, {
                callbacks: {
                  title: (items) => 'Year ' + items[0].label,
                  label: (ctx) => 'DPS ' + fmtUsd4(ctx.parsed.y),
                },
              }),
            },
            scales: {
              x: axis({ grid: { display: false } }),
              y: axis({ beginAtZero: true, ticks: { color: t.text, font: { size: 10 }, callback: (v) => '$' + v.toFixed(2) } }),
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
              borderWidth: 1.5, pointRadius: 2, pointHoverRadius: 5,
              pointBackgroundColor: t.cyan, fill: false, stepped: true,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: Object.assign({}, tooltipDefaults, {
                callbacks: {
                  title: (items) => items[0].raw.x,
                  label: (ctx) => fmtUsd4(ctx.parsed.y) + ' / share',
                },
              }),
            },
            scales: {
              x: axis({ type: 'time', time: { unit: 'year' }, grid: { display: false } }),
              y: axis({ beginAtZero: true, ticks: { color: t.text, font: { size: 10 }, callback: (v) => '$' + v.toFixed(2) } }),
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
              borderWidth: 2, fill: true, tension: 0.3,
              pointRadius: 0, pointHoverRadius: 6,
              pointBackgroundColor: t.emerald,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: Object.assign({}, tooltipDefaults, {
                callbacks: {
                  title: (items) => items[0].raw.x,
                  label: (ctx) => 'TTM DPS ' + fmtUsd2(ctx.parsed.y),
                },
              }),
            },
            scales: {
              x: axis({ type: 'time', time: { unit: 'year' }, grid: { display: false } }),
              y: axis({ beginAtZero: true, ticks: { color: t.text, font: { size: 10 }, callback: (v) => '$' + v.toFixed(2) } }),
            },
          },
        });
      }

      // Sector donut (ETF only)
      if (document.getElementById('sectorChart') && data.sectorWeights && data.sectorWeights.length > 0) {
        const labels = data.sectorWeights.map((s) => s.sector);
        const values = data.sectorWeights.map((s) => s.pct);
        new Chart(document.getElementById('sectorChart'), {
          type: 'doughnut',
          data: {
            labels,
            datasets: [{
              data: values,
              backgroundColor: t.sector.slice(0, labels.length),
              borderColor: t.isLight ? '#ffffff' : '#161b27',
              borderWidth: 2,
              hoverOffset: 6,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '62%',
            plugins: {
              legend: {
                position: 'right',
                labels: { color: t.legend, font: { size: 11 }, boxWidth: 10, boxHeight: 10, padding: 8 },
              },
              tooltip: Object.assign({}, tooltipDefaults, {
                callbacks: { label: (ctx) => ctx.label + ' ' + (ctx.parsed * 100).toFixed(1) + '%' },
              }),
            },
          },
        });
      }

      // Anchor ribbon: highlight current section
      const ribbonLinks = document.querySelectorAll('.anchor-ribbon a');
      const sections = Array.from(ribbonLinks).map((a) => {
        const id = a.getAttribute('href').replace('#', '');
        return { link: a, el: document.getElementById(id) };
      }).filter((x) => x.el);
      function updateRibbon() {
        const y = window.scrollY + 110;
        let active = sections[0];
        for (const s of sections) {
          if (s.el.offsetTop <= y) active = s;
        }
        ribbonLinks.forEach((a) => a.classList.remove('is-active'));
        if (active) active.link.classList.add('is-active');
      }
      window.addEventListener('scroll', updateRibbon, { passive: true });
      updateRibbon();

      // Income simulator
      const simInput = document.getElementById('sim-amount');
      if (simInput) {
        const fmt0 = (n) => '$' + (Math.round(n)).toLocaleString();
        const fwd = data.forwardYield || 0;
        const cagr = data.cagr5y || 0;
        const price = data.priceDollars || 0;
        function update() {
          const dollars = parseFloat(simInput.value || '0');
          const shares = price > 0 ? dollars / price : 0;
          const yr1 = dollars * fwd;
          const yr5 = yr1 * Math.pow(1 + cagr, 5);
          const yr10 = yr1 * Math.pow(1 + cagr, 10);
          const cum10 = (function() {
            let acc = 0;
            for (let y = 0; y < 10; y++) acc += yr1 * Math.pow(1 + cagr, y);
            return acc;
          })();
          const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
          set('sim-shares', shares.toFixed(2));
          set('sim-yr1', fmt0(yr1));
          set('sim-yr5', fmt0(yr5));
          set('sim-yr10', fmt0(yr10));
          set('sim-cum10', fmt0(cum10));
        }
        simInput.addEventListener('input', update);
        update();
      }
    })();
  </script>
  `;

  return renderLayout({
    title: c.ticker,
    active: 'ticker',
    head,
    body,
    asOf: c.priceAsOf ?? null,
  });
}

// ----- Helpers --------------------------------------------------------------

function computeTtmSeries(history: DividendHistoryPoint[]): { exDate: string; ttm: number }[] {
  const sorted = [...history].sort((a, b) => (a.exDate < b.exDate ? -1 : 1));
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

function metricCard(opts: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn';
}): string {
  const toneClass =
    opts.tone === 'good'
      ? 'positive'
      : opts.tone === 'bad'
        ? 'negative'
        : opts.tone === 'warn'
          ? 'accent-2-text'
          : 'ink';
  return `
  <div class="surface p-3.5">
    <div class="label">${escapeHtml(opts.label)}</div>
    <div class="num font-semibold text-[18px] ${toneClass} mt-1">${escapeHtml(opts.value)}</div>
    ${opts.sub ? `<div class="text-[11px] muted mt-0.5">${escapeHtml(opts.sub)}</div>` : ''}
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

  cards.push(metricCard({ label: 'P/E (TTM)', value: fmtRatio(snap.peTrailing) }));
  cards.push(metricCard({ label: 'P/E (Fwd)', value: fmtRatio(snap.peForward) }));
  cards.push(metricCard({ label: 'P/S (TTM)', value: fmtRatio(snap.psRatio) }));
  cards.push(metricCard({ label: 'P/B', value: fmtRatio(snap.pbRatio) }));
  cards.push(metricCard({ label: 'PEG', value: fmtRatio(snap.pegRatio) }));
  cards.push(metricCard({ label: 'Market cap', value: fmtBigUsd(snap.marketCap) }));
  cards.push(metricCard({ label: 'Enterprise val.', value: fmtBigUsd(snap.enterpriseValue) }));
  cards.push(metricCard({ label: 'EV / EBITDA', value: fmtRatio(snap.evToEbitda) }));
  cards.push(metricCard({ label: 'Beta', value: fmtRatio(snap.beta) }));
  cards.push(
    metricCard({
      label: 'EPS (TTM)',
      value: snap.epsTrailing !== null ? `$${fmtRatio(snap.epsTrailing)}` : '—',
    }),
  );
  cards.push(
    metricCard({
      label: 'EPS (Fwd)',
      value: snap.epsForward !== null ? `$${fmtRatio(snap.epsForward)}` : '—',
    }),
  );
  cards.push(metricCard({ label: 'Profit margin', value: fmtFracPct(snap.profitMargins, 1) }));
  cards.push(metricCard({ label: 'ROE', value: fmtFracPct(snap.returnOnEquity, 1) }));
  cards.push(metricCard({ label: 'ROA', value: fmtFracPct(snap.returnOnAssets, 1) }));
  cards.push(metricCard({ label: 'Free cash flow', value: fmtBigUsd(snap.freeCashFlow) }));
  cards.push(metricCard({ label: 'Total debt', value: fmtBigUsd(snap.totalDebt) }));
  cards.push(metricCard({ label: 'Total cash', value: fmtBigUsd(snap.totalCash) }));
  cards.push(
    metricCard({
      label: 'Volume (avg 3m)',
      value: fmtVol(snap.avgVolume3m),
      sub: snap.volume !== null ? `today ${fmtVol(snap.volume)}` : '',
    }),
  );

  return cards;
}

function buildEtfFundamentalsCards(snap: QuoteSnapshotRow | null): string[] {
  if (!snap) return [];
  const cards: string[] = [];

  cards.push(
    metricCard({ label: 'Market cap / AUM', value: fmtBigUsd(snap.totalAssets ?? snap.marketCap) }),
  );
  cards.push(metricCard({ label: 'Expense ratio', value: fmtFracPct(snap.expenseRatio, 2) }));
  cards.push(
    metricCard({ label: 'Dividend yield (Yahoo)', value: fmtFracPct(snap.dividendYield, 2) }),
  );
  cards.push(
    metricCard({
      label: 'YTD return',
      value: fmtFracPct(snap.ytdReturn, 2),
      tone: (snap.ytdReturn ?? 0) >= 0 ? 'good' : 'bad',
    }),
  );
  cards.push(
    metricCard({
      label: '3y return',
      value: fmtFracPct(snap.threeYearReturn, 2),
      tone: (snap.threeYearReturn ?? 0) >= 0 ? 'good' : 'bad',
    }),
  );
  cards.push(
    metricCard({
      label: '5y return',
      value: fmtFracPct(snap.fiveYearReturn, 2),
      tone: (snap.fiveYearReturn ?? 0) >= 0 ? 'good' : 'bad',
    }),
  );
  cards.push(metricCard({ label: 'Beta', value: fmtRatio(snap.beta) }));
  cards.push(metricCard({ label: 'P/E (TTM)', value: fmtRatio(snap.peTrailing) }));
  cards.push(
    metricCard({
      label: 'NAV proxy',
      value: snap.price !== null ? `$${fmtRatio(snap.price)}` : '—',
    }),
  );
  cards.push(metricCard({ label: 'Fund family', value: snap.fundFamily ?? '—' }));
  cards.push(metricCard({ label: 'Inception', value: snap.inceptionDate ?? '—' }));
  cards.push(metricCard({ label: 'Volume (avg 3m)', value: fmtVol(snap.avgVolume3m) }));

  return cards;
}

function renderEtfHoldings(holdings: EtfHoldingRow[], profile: EtfProfileRow | null): string {
  if (holdings.length === 0 && (!profile || profile.sectorWeights.length === 0)) return '';

  const top = holdings.slice(0, 10);
  const maxPct = Math.max(0.0001, ...top.map((h) => h.allocationPct));

  return /* html */ `
  <section id="holdings" class="anchor-target space-y-3">
    <div class="section-h">
      <div class="flex items-baseline gap-3">
        <span class="label">Top holdings &amp; sector mix</span>
        ${profile?.totalHoldings ? `<span class="text-[12px] muted">${profile.totalHoldings.toLocaleString()} total holdings</span>` : ''}
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div class="surface p-4 lg:col-span-2">
        <h3 class="editorial text-base ink mb-3">Top ${top.length} holdings</h3>
        <ol class="space-y-2">
          ${top
            .map((h) => {
              const w = (h.allocationPct / maxPct) * 100;
              return `<li class="flex items-center gap-3 text-[13px]">
              <span class="muted num text-[11px] w-5 text-right">${h.position}</span>
              <span class="font-mono font-semibold ink w-16 truncate">${escapeHtml(h.symbol ?? '—')}</span>
              <div class="flex-1">
                <div class="bar-track" style="height:8px;">
                  <div class="bar-fill" style="width:${w.toFixed(1)}%; background: var(--accent);"></div>
                </div>
                <div class="text-[11.5px] ink-3 mt-0.5 truncate">${escapeHtml(h.name)}</div>
              </div>
              <span class="num accent-text font-semibold w-14 text-right">${(h.allocationPct * 100).toFixed(2)}%</span>
            </li>`;
            })
            .join('')}
        </ol>
      </div>
      ${
        profile && profile.sectorWeights.length > 0
          ? `<div class="surface p-4">
              <h3 class="editorial text-base ink mb-3">Sector mix</h3>
              <div class="relative" style="height:240px;">
                <canvas id="sectorChart"></canvas>
              </div>
            </div>`
          : ''
      }
    </div>
  </section>
  `;
}

function renderNewsList(news: NewsRow[]): string {
  if (news.length === 0) return '';
  const now = Date.now();
  const formatRelative = (iso: string): string => {
    const t = new Date(iso).getTime();
    const dt = (now - t) / 1000;
    if (dt < 60) return `${Math.floor(dt)}s ago`;
    if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
    if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
    if (dt < 86400 * 7) return `${Math.floor(dt / 86400)}d ago`;
    return iso.slice(0, 10);
  };
  const dotClass = (iso: string): string => {
    const dt = (now - new Date(iso).getTime()) / 1000;
    if (dt < 3600) return 'fresh';
    if (dt < 21600) return 'recent';
    return '';
  };

  return /* html */ `
  <section id="news" class="anchor-target space-y-3">
    <div class="section-h">
      <div class="flex items-baseline gap-3">
        <span class="label">Latest news</span>
        <span class="text-[12px] muted">${news.length} items</span>
      </div>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      ${news
        .map(
          (
            n,
          ) => `<a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer" class="news-item">
            <div class="meta mb-1">
              <span class="dot ${dotClass(n.publishedAt)}"></span>
              <span class="ink-3">${escapeHtml(n.publisher ?? 'Unknown')}</span>
              <span class="muted"> · ${formatRelative(n.publishedAt)}</span>
            </div>
            <div class="text-[13.5px] ink leading-snug font-medium line-clamp-2">${escapeHtml(n.title)}</div>
          </a>`,
        )
        .join('')}
    </div>
  </section>
  `;
}

function renderSummary(summary: string, website: string | null, title: string): string {
  return /* html */ `
  <section id="about" class="anchor-target">
    <details class="surface p-4">
      <summary class="cursor-pointer flex items-center justify-between gap-2 list-none">
        <span class="label">${escapeHtml(title)}</span>
        ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer" class="text-[11.5px] accent-text hover:underline">${escapeHtml(website.replace(/^https?:\/\//, ''))}</a>` : ''}
      </summary>
      <p class="mt-3 text-[13px] ink-3 leading-relaxed">${escapeHtml(summary)}</p>
    </details>
  </section>
  `;
}

function renderIncomeSimulator(c: TickerCard, price: number | null): string {
  const fwd = c.forwardYield ?? 0;
  const cagr = c.cagr5y ?? 0;
  const defaultAmount = 10000;

  return /* html */ `
  <div class="surface p-5">
    <div class="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
      <div class="md:col-span-2">
        <label for="sim-amount" class="label">Investment</label>
        <div class="flex items-center gap-2 mt-2">
          <span class="text-2xl muted">$</span>
          <input id="sim-amount" type="number" min="0" step="100" value="${defaultAmount}" class="input flex-1 text-2xl font-mono" style="font-weight:600;padding:10px 12px;">
        </div>
        <div class="text-[11.5px] muted mt-1.5">
          ≈ <span id="sim-shares" class="num ink-3">0</span> shares at <span class="num ink-3">${price !== null ? `$${price.toFixed(2)}` : '—'}</span>
          · forward yield <span class="num accent-text">${fmtPct(fwd, 2)}</span>
          · 5y CAGR <span class="num accent-text">${fmtPct(cagr, 1)}</span>
        </div>
      </div>
      <div class="kpi">
        <span class="label">Year 1 income</span>
        <div class="value accent-text" id="sim-yr1">$0</div>
        <div class="sub">at today's yield</div>
      </div>
      <div class="kpi">
        <span class="label">Year 5 income</span>
        <div class="value" id="sim-yr5">$0</div>
        <div class="sub">if growth continues</div>
      </div>
      <div class="kpi">
        <span class="label">Year 10 income</span>
        <div class="value" id="sim-yr10">$0</div>
        <div class="sub">cumulative <span class="num ink-2" id="sim-cum10">$0</span></div>
      </div>
    </div>
    <div class="mt-3 text-[11px] faint italic">
      Projection assumes the company holds its current yield and grows the dividend at its 5-year CAGR. Real life is messier — payouts can be cut, prices move, taxes apply.
    </div>
  </div>
  `;
}
