/**
 * Calendar view (v0.5).
 *
 * Top: 30/60/90-day income summary KPI strip.
 *
 * Below: month-grouped tables with subtotal per month + per-payment rows.
 * Tables are denser than the old card grid — the goal is to scan a long
 * list of dates quickly, not browse cards.
 */

import type { CalendarEntry } from '../data.ts';
import { escapeHtml, renderLayout } from './layout.ts';

interface CalendarPageData {
  upcoming: CalendarEntry[];
}

export function renderCalendarPage(data: CalendarPageData): string {
  // Group by month
  const byMonth = new Map<string, CalendarEntry[]>();
  for (const e of data.upcoming) {
    const key = e.exDate.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  const months = Array.from(byMonth.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // 30/60/90 day summaries
  const sumWindow = (n: number) => {
    const inWin = data.upcoming.filter((e) => e.daysUntil <= n);
    return {
      count: inWin.length,
      perShare: inWin.reduce((acc, e) => acc + e.amount, 0),
    };
  };
  const w30 = sumWindow(30);
  const w60 = sumWindow(60);
  const w90 = sumWindow(90);

  const monthLabel = (yyyymm: string) => {
    const [y, m] = yyyymm.split('-').map((s) => Number.parseInt(s, 10));
    return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  const body = /* html */ `
  <div class="space-y-6">
    <div>
      <h1 class="display text-3xl ink">Dividend calendar</h1>
      <p class="text-[13px] muted mt-1">
        Estimated upcoming ex-dividend dates for the next 90 days, projected from the
        last known payment plus each ticker's detected frequency.
        <span class="faint">Real ex-dates are usually announced 1–2 quarters ahead — these are planning-grade estimates.</span>
      </p>
    </div>

    <!-- Window KPIs -->
    <section>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="kpi">
          <span class="label">Next 30 days</span>
          <div class="value">${w30.perShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${w30.count} ex-dates</div>
        </div>
        <div class="kpi">
          <span class="label">Next 60 days</span>
          <div class="value">${w60.perShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${w60.count} ex-dates</div>
        </div>
        <div class="kpi">
          <span class="label">Next 90 days</span>
          <div class="value accent-text">${w90.perShare.toFixed(2)}<span class="text-base muted ml-1">$/sh</span></div>
          <div class="sub">${w90.count} ex-dates</div>
        </div>
      </div>
    </section>

    ${
      months.length === 0
        ? '<p class="surface p-8 text-center muted">No upcoming dividends in the next 90 days.</p>'
        : months
            .map(([month, entries]) => {
              const label = monthLabel(month);
              const subtotal = entries.reduce((acc, e) => acc + e.amount, 0);
              return /* html */ `
              <section class="surface p-4">
                <div class="section-h">
                  <div class="flex items-baseline gap-3">
                    <h2 class="editorial">${escapeHtml(label)}</h2>
                    <span class="text-[12px] muted">${entries.length} payment${entries.length === 1 ? '' : 's'}</span>
                  </div>
                  <span class="text-[12px] num accent-text">$${subtotal.toFixed(2)} total</span>
                </div>
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th>Name</th>
                      <th class="text-right">Ex-date</th>
                      <th class="text-right">Days</th>
                      <th class="text-right">Last DPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${entries.map((e) => renderCalendarRow(e)).join('')}
                  </tbody>
                </table>
              </section>`;
            })
            .join('')
    }
  </div>
  `;

  return renderLayout({
    title: 'Calendar',
    active: 'calendar',
    body,
  });
}

function renderCalendarRow(e: CalendarEntry): string {
  const [y, m, d] = e.exDate.split('-').map((s) => Number.parseInt(s, 10));
  const exDateLabel = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  const urgencyClass =
    e.daysUntil <= 7
      ? 'pill pill-emerald'
      : e.daysUntil <= 30
        ? 'pill pill-cyan'
        : 'pill pill-slate';

  return /* html */ `
    <tr>
      <td><a href="/ticker/${escapeHtml(e.ticker)}" class="ticker-cell" style="text-decoration:none;">${escapeHtml(e.ticker)}</a></td>
      <td class="muted truncate" style="max-width:280px;">${escapeHtml(e.name)}</td>
      <td class="num-cell ink">${escapeHtml(exDateLabel)}</td>
      <td class="text-right"><span class="${urgencyClass}">${e.daysUntil}d</span></td>
      <td class="num-cell accent-text">$${e.amount.toFixed(4)}</td>
    </tr>
  `;
}
