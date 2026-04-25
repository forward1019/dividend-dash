/**
 * Shared HTML layout. All pages render through this so navigation, theme,
 * and design system are consistent.
 */

export interface LayoutOpts {
  title: string;
  active: 'dashboard' | 'compare' | 'calendar' | 'ticker';
  body: string;
  /** Extra <head> entries (per-page scripts, e.g. embedded JSON). */
  head?: string;
  /** Extra footer scripts to run after body. */
  footerScripts?: string;
}

const NAV_LINKS: { href: string; label: string; key: LayoutOpts['active'] }[] = [
  { href: '/', label: 'Dashboard', key: 'dashboard' },
  { href: '/compare', label: 'Compare', key: 'compare' },
  { href: '/calendar', label: 'Calendar', key: 'calendar' },
];

export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += String(values[i] ?? '');
  });
  return out;
}

export function escapeHtml(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function renderLayout(opts: LayoutOpts): string {
  const navHtml = NAV_LINKS.map((link) => {
    const isActive = link.key === opts.active;
    const cls = isActive
      ? 'text-emerald-400 border-emerald-400'
      : 'text-slate-400 border-transparent hover:text-slate-100 hover:border-slate-600';
    return `<a href="${link.href}" class="px-4 py-2 border-b-2 ${cls} transition-colors text-sm font-medium">${link.label}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} · dividend-dash</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        fontFamily: {
          sans: ['Inter', 'system-ui', 'sans-serif'],
          mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        },
      },
    },
  };
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/cdn.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<style>
  :root {
    color-scheme: dark;
  }
  body {
    background:
      radial-gradient(1200px 800px at 10% -10%, rgba(16,185,129,0.07), transparent),
      radial-gradient(1000px 700px at 110% 0%, rgba(99,102,241,0.06), transparent),
      #0b0f17;
    min-height: 100vh;
    font-feature-settings: 'cv11', 'ss01', 'ss03';
  }
  .glass {
    background: rgba(15, 23, 36, 0.6);
    backdrop-filter: blur(8px);
    border: 1px solid rgba(148, 163, 184, 0.08);
  }
  .glass-strong {
    background: rgba(15, 23, 36, 0.85);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(148, 163, 184, 0.12);
  }
  .num {
    font-feature-settings: 'tnum';
    font-variant-numeric: tabular-nums;
  }
  .score-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.95rem;
    border: 2px solid currentColor;
  }
  .ticker-card {
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .ticker-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 32px -12px rgba(16, 185, 129, 0.25);
    border-color: rgba(16, 185, 129, 0.35);
  }
  .sparkline {
    height: 32px;
    width: 100%;
  }
  /* Custom scrollbar */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: rgba(15,23,36,0.4); }
  ::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.4); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.6); }
</style>
${opts.head ?? ''}
</head>
<body class="text-slate-100 font-sans antialiased">
  <header class="glass-strong sticky top-0 z-30 border-b border-slate-800/60">
    <div class="max-w-7xl mx-auto px-6 py-3 flex items-center gap-8">
      <a href="/" class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 text-slate-900">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <span class="font-bold tracking-tight text-lg">dividend-dash</span>
        <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">v0.2</span>
      </a>
      <nav class="flex items-center gap-0">${navHtml}</nav>
      <div class="flex-1"></div>
      <form action="/ticker" method="get" class="flex items-center gap-2">
        <input
          name="symbol"
          placeholder="Search ticker…"
          class="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-emerald-500 focus:w-56 transition-all placeholder:text-slate-500"
          autocomplete="off"
        >
      </form>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-8">
    ${opts.body}
  </main>

  <footer class="max-w-7xl mx-auto px-6 py-12 text-center text-slate-500 text-xs border-t border-slate-800/40 mt-12">
    <p>dividend-dash · personal dividend research · not financial advice</p>
    <p class="mt-1">Data: Yahoo Finance &amp; SEC EDGAR · refreshed manually via <code class="text-slate-400">bun run seed-universe</code></p>
  </footer>

  ${opts.footerScripts ?? ''}
</body>
</html>`;
}

// === Shared format helpers used by views ===

export function fmtUsd(cents: number | null, opts: { decimals?: number } = {}): string {
  if (cents === null) return '—';
  return `$${(cents / 100).toFixed(opts.decimals ?? 2)}`;
}

export function fmtPct(ratio: number | null, decimals = 2): string {
  if (ratio === null || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals)}%`;
}

export function fmtNum(n: number | null, decimals = 2): string {
  if (n === null || Number.isNaN(n)) return '—';
  return n.toFixed(decimals);
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return d;
}

/** Color a sustainability score 0–100. */
export function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-lime-400';
  if (score >= 40) return 'text-amber-400';
  if (score >= 20) return 'text-orange-400';
  return 'text-rose-400';
}

/** Color a yield (higher = warmer). */
export function yieldColor(y: number | null): string {
  if (y === null) return 'text-slate-400';
  if (y >= 0.08) return 'text-rose-400';
  if (y >= 0.05) return 'text-amber-400';
  if (y >= 0.03) return 'text-emerald-400';
  return 'text-slate-300';
}
