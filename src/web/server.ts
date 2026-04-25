/**
 * Bun.serve web dashboard for dividend-dash.
 *
 *   bun run web
 *
 * Then open http://localhost:5173.
 *
 * Routes:
 *   GET /                  — dashboard with all 40 universe tickers
 *   GET /ticker/:symbol    — per-ticker drill-down
 *   GET /ticker?symbol=X   — search redirect (used by header search box)
 *   GET /compare?t=X&t=Y   — compare up to 6 tickers
 *   GET /calendar          — upcoming ex-dividend dates
 *
 * JSON API:
 *   GET /api/universe      — list of all cards
 *   GET /api/ticker/:t     — single card + history
 *   GET /api/calendar      — upcoming ex-dividends
 *   POST /api/refresh-prices — re-fetch latest quote for everything (slow!)
 */

import { dividendCagr } from '../analytics/dividend-stats.ts';
import { log } from '../lib/logger.ts';
import {
  buildAllCards,
  buildCalendar,
  buildTickerCard,
  clearCache,
  getDividendHistory,
} from './data.ts';
import { getTicker } from './tickers.ts';
import { renderCalendarPage } from './views/calendar.ts';
import { renderComparePage } from './views/compare.ts';
import { renderDashboard } from './views/dashboard.ts';
import { renderTickerPage } from './views/ticker.ts';

const PORT = Number.parseInt(process.env.DD_WEB_PORT ?? '5173', 10);

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const notFound = (msg = 'Not found') => html(notFoundPage(msg), 404);

function notFoundPage(msg: string): string {
  return /* html */ `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>404 — dividend-dash</title>
<script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-slate-950 text-slate-200 min-h-screen flex items-center justify-center">
  <div class="text-center">
    <div class="text-6xl font-bold text-emerald-400">404</div>
    <p class="mt-2 text-slate-400">${msg}</p>
    <a href="/" class="mt-4 inline-block px-4 py-2 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30">Back to dashboard</a>
  </div></body></html>`;
}

function renderError(err: unknown): Response {
  const msg = err instanceof Error ? err.message : String(err);
  log.error('Server error', { msg });
  return html(
    `<!DOCTYPE html><html><body style="background:#0b0f17;color:#e2e8f0;padding:32px;font-family:monospace;">
       <h1 style="color:#f87171">Server error</h1>
       <pre style="white-space:pre-wrap;background:#1e293b;padding:16px;border-radius:8px;">${escapeForHtml(msg)}</pre>
     </body></html>`,
    500,
  );
}

function escapeForHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  );
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch(req) {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      // === HTML routes ===

      if (path === '/' || path === '/dashboard') {
        const cards = buildAllCards();
        const history: Record<string, { exDate: string; amount: number }[]> = {};
        for (const c of cards) {
          history[c.ticker] = getDividendHistory(c.ticker);
        }
        return html(renderDashboard({ cards, history }));
      }

      // /ticker?symbol=XYZ — redirect from header search
      if (path === '/ticker') {
        const sym = url.searchParams.get('symbol');
        if (sym) {
          return Response.redirect(`/ticker/${encodeURIComponent(sym.toUpperCase())}`, 302);
        }
        return Response.redirect('/', 302);
      }

      // /ticker/SYMBOL
      const tickerMatch = path.match(/^\/ticker\/([A-Za-z0-9.-]+)\/?$/);
      if (tickerMatch) {
        const sym = tickerMatch[1]!.toUpperCase();
        const u = getTicker(sym);
        if (!u) return notFound(`${sym} is not in the tracked universe (yet).`);
        const card = buildTickerCard(u);
        const history = getDividendHistory(sym);
        // Compute additional CAGRs for stat boxes
        const events = history.map((p) => ({
          exDate: p.exDate,
          amountPerShareMicros: Math.round(p.amount * 1_000_000),
        }));
        const cagr1y = dividendCagr(events, 1);
        const cagr3y = dividendCagr(events, 3);
        return html(renderTickerPage({ card, history, cagr1y, cagr3y }));
      }

      if (path === '/compare') {
        const allCards = buildAllCards();
        const requested = url.searchParams.getAll('t').map((t) => t.toUpperCase());
        const selected = requested
          .map((sym) => {
            const u = getTicker(sym);
            return u ? buildTickerCard(u) : null;
          })
          .filter((c): c is NonNullable<typeof c> => c !== null);
        const series: Record<string, { exDate: string; ttm: number }[]> = {};
        for (const c of selected) {
          series[c.ticker] = computeTtm(getDividendHistory(c.ticker));
        }
        return html(renderComparePage({ allCards, selected, series }));
      }

      if (path === '/calendar') {
        const upcoming = buildCalendar(90);
        return html(renderCalendarPage({ upcoming }));
      }

      // === JSON API ===

      if (path === '/api/universe') {
        return json(buildAllCards());
      }

      const apiTickerMatch = path.match(/^\/api\/ticker\/([A-Za-z0-9.-]+)\/?$/);
      if (apiTickerMatch) {
        const sym = apiTickerMatch[1]!.toUpperCase();
        const u = getTicker(sym);
        if (!u) return json({ error: 'unknown ticker' }, 404);
        return json({
          card: buildTickerCard(u),
          history: getDividendHistory(sym),
        });
      }

      if (path === '/api/calendar') {
        const days = Number.parseInt(url.searchParams.get('days') ?? '90', 10);
        return json(buildCalendar(days));
      }

      if (path === '/api/refresh-cache' && req.method === 'POST') {
        clearCache();
        return json({ ok: true });
      }

      // === Health ===
      if (path === '/health') {
        return json({ ok: true, port: PORT, ts: new Date().toISOString() });
      }

      return notFound();
    } catch (err) {
      return renderError(err);
    }
  },
});

log.info(`dividend-dash web server listening on http://${server.hostname}:${server.port}`);

function computeTtm(
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
