/**
 * Calendar view — upcoming ex-dividend dates for the universe.
 *
 * Estimated by extrapolating the last known payment forward by the
 * detected frequency. yfinance does include forward ex-dates when
 * known, but only ~1 quarter out — this is "good enough for planning"
 * not "precision-record".
 */

import type { CalendarEntry } from '../data.ts';
import { escapeHtml, renderLayout } from './layout.ts';

interface CalendarPageData {
  upcoming: CalendarEntry[];
}

export function renderCalendarPage(data: CalendarPageData): string {
  // Group by month for readability
  const byMonth = new Map<string, CalendarEntry[]>();
  for (const e of data.upcoming) {
    const key = e.exDate.slice(0, 7); // YYYY-MM
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(e);
  }
  const months = Array.from(byMonth.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  // Construct dates from "YYYY-MM" by parsing each part — `new Date('YYYY-MM-01')`
  // is interpreted as UTC midnight, which lands in the previous month in
  // negative-offset locales (e.g. PDT). Avoid the trap by constructing
  // explicitly in local time.
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
      <h1 class="text-2xl font-bold">Dividend calendar</h1>
      <p class="text-sm text-slate-400 mt-1">
        Estimated upcoming ex-dividend dates for the next 90 days, projected from
        the last known payment + each ticker's detected frequency.
        <span class="text-slate-500">Real ex-dates are usually announced 1–2 quarters ahead — these are planning-grade estimates.</span>
      </p>
    </div>

    ${
      months.length === 0
        ? '<p class="glass rounded-2xl p-8 text-center text-slate-400">No upcoming dividends in the next 90 days.</p>'
        : months
            .map(([month, entries]) => {
              const label = monthLabel(month);
              return `
              <section class="glass rounded-2xl p-5">
                <h3 class="font-semibold text-slate-100 mb-3 flex items-baseline gap-2">
                  <span class="text-emerald-400">${escapeHtml(label)}</span>
                  <span class="text-xs text-slate-500">${entries.length} payment${entries.length === 1 ? '' : 's'}</span>
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  ${entries.map((e) => renderCalendarCard(e)).join('')}
                </div>
              </section>
            `;
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

function renderCalendarCard(e: CalendarEntry): string {
  const urgency =
    e.daysUntil <= 7
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : e.daysUntil <= 30
        ? 'border-cyan-500/30 bg-cyan-500/5'
        : 'border-slate-700 bg-slate-900/40';

  // Same UTC-vs-local trap as monthLabel — parse explicitly.
  const [y, m, d] = e.exDate.split('-').map((s) => Number.parseInt(s, 10));
  const exDateLabel = new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return `
    <a href="/ticker/${escapeHtml(e.ticker)}" class="block rounded-xl p-4 border ${urgency} hover:border-emerald-500/60 transition-colors">
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-mono font-bold text-slate-100">${escapeHtml(e.ticker)}</span>
        <span class="text-xs text-slate-400">${e.daysUntil}d</span>
      </div>
      <div class="text-xs text-slate-400 mt-0.5 truncate">${escapeHtml(e.name)}</div>
      <div class="flex items-baseline justify-between mt-3">
        <div>
          <div class="text-[10px] uppercase tracking-wider text-slate-500">Ex-date</div>
          <div class="text-sm text-slate-100">${escapeHtml(exDateLabel)}</div>
        </div>
        <div class="text-right">
          <div class="text-[10px] uppercase tracking-wider text-slate-500">Last DPS</div>
          <div class="text-sm num text-emerald-400 font-semibold">$${e.amount.toFixed(4)}</div>
        </div>
      </div>
    </a>
  `;
}
