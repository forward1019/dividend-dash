/**
 * Shared HTML layout. All pages render through this so navigation, theme,
 * and design system are consistent.
 *
 * Theming
 * -------
 * Three user-selectable themes:
 *   - "light"      — forced light mode
 *   - "dark"       — forced dark mode (the original v0.2 look)
 *   - "light-dark" — auto-follow the OS via prefers-color-scheme (default)
 *
 * Implementation:
 *   - The user preference is persisted in localStorage as `dd_theme`.
 *   - A synchronous pre-paint script in <head> resolves the preference into a
 *     concrete `data-resolved-theme` ("light" | "dark") on <html> before the
 *     first paint (no flash-of-wrong-theme).
 *   - CSS overrides target `[data-resolved-theme="light"]` and remap the
 *     slate utility classes used across every view, so individual views
 *     don't need theme-aware class soup.
 *   - When the OS scheme flips while the user is in "light-dark" mode, a
 *     matchMedia listener swaps the resolved attribute live.
 *   - Switching themes from the toggle reloads the page — Chart.js
 *     instances need to be re-created with new palette colors anyway, and
 *     URL state (search params, selected tickers) is fully preserved.
 *   - Charts read colors from `window.__chartTheme()` at construction time,
 *     so the same chart code renders correctly in either resolved theme.
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

/**
 * Pre-paint script — runs synchronously in <head> BEFORE Tailwind/CSS so the
 * theme attributes are set before first paint. Avoids a flash of dark
 * content on a light-preference user, or vice versa.
 */
const PREPAINT_SCRIPT = `
(function() {
  try {
    var saved = localStorage.getItem('dd_theme');
    var pref = (saved === 'light' || saved === 'dark' || saved === 'light-dark') ? saved : 'light-dark';
    var resolved = pref;
    if (pref === 'light-dark') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', pref);
    root.setAttribute('data-resolved-theme', resolved);
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
  } catch (e) {
    // localStorage blocked etc. — fall back to dark, which is the original look
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-resolved-theme', 'dark');
    document.documentElement.classList.add('dark');
  }
})();
`;

/**
 * Theme runtime — wires up the toggle, persistence, and live OS-scheme
 * watching. Runs after Alpine/Chart.js so charts can register a refresh
 * helper that the toggle calls on swap.
 */
const THEME_RUNTIME_SCRIPT = `
(function() {
  var root = document.documentElement;

  function resolve(pref) {
    if (pref === 'light' || pref === 'dark') return pref;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function apply(pref, opts) {
    var prev = root.getAttribute('data-resolved-theme');
    var next = resolve(pref);
    root.setAttribute('data-theme', pref);
    root.setAttribute('data-resolved-theme', next);
    root.classList.toggle('dark', next === 'dark');
    root.style.colorScheme = next;
    try { localStorage.setItem('dd_theme', pref); } catch(e) {}
    // If the resolved theme actually changed, reload so chart palettes pick
    // up the new colors. Page state (URL params) is preserved.
    if (opts && opts.reloadOnSwap && prev && prev !== next) {
      window.location.reload();
    }
  }

  // Wire toggle buttons (rendered as a segmented control in the header)
  var btns = document.querySelectorAll('[data-theme-set]');
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var pref = btn.getAttribute('data-theme-set');
        apply(pref, { reloadOnSwap: true });
        // Re-paint segmented control immediately even if no reload triggers
        updateActive();
      });
    })(btns[i]);
  }

  function updateActive() {
    var current = root.getAttribute('data-theme') || 'light-dark';
    var all = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < all.length; i++) {
      var b = all[i];
      var active = b.getAttribute('data-theme-set') === current;
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      b.classList.toggle('theme-btn-active', active);
    }
  }
  updateActive();

  // Watch OS preference for users in "light-dark" mode
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var mqListener = function() {
    var pref = root.getAttribute('data-theme');
    if (pref === 'light-dark') {
      apply('light-dark', { reloadOnSwap: true });
    }
  };
  if (mq.addEventListener) mq.addEventListener('change', mqListener);
  else if (mq.addListener) mq.addListener(mqListener); // Safari < 14
})();
`;

/**
 * Command-palette runtime — Cmd+K / Ctrl+K opens a centered search overlay
 * that fuzzy-matches the universe and navigates to /ticker/SYMBOL.
 *
 * Self-contained vanilla JS so it works on every page without Alpine.
 *
 *   - Trigger:    Cmd/Ctrl-K, click the header search button, or `/`
 *   - Close:      Esc, backdrop click, or pick a result
 *   - Navigate:   ↑/↓ arrows; Enter selects highlighted item
 *   - Data:       fetched once from /api/universe, cached in memory
 */
const CMDK_RUNTIME_SCRIPT = `
(function() {
  var overlay = document.getElementById('dd-cmdk');
  var input = document.getElementById('dd-cmdk-input');
  var results = document.getElementById('dd-cmdk-results');
  var trigger = document.getElementById('dd-cmdk-trigger');
  if (!overlay || !input || !results) return;

  var universe = null;       // cached universe array
  var highlight = 0;         // index of highlighted result
  var lastFiltered = [];     // current matches in display order
  var loadPromise = null;

  function ensureUniverse() {
    if (universe) return Promise.resolve(universe);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('/api/universe').then(function(r) { return r.json(); }).then(function(data) {
      // Normalize — trim to fields we actually use to keep filter() cheap.
      universe = (Array.isArray(data) ? data : []).map(function(c) {
        return {
          ticker: c.ticker,
          name: c.name,
          kind: c.kind,
          categoryLabel: c.categoryLabel,
          forwardYield: c.forwardYield,
        };
      });
      return universe;
    }).catch(function() { universe = []; return universe; });
    return loadPromise;
  }

  function open() {
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    document.body.style.overflow = 'hidden';
    input.value = '';
    highlight = 0;
    ensureUniverse().then(render);
    setTimeout(function() { input.focus(); }, 30);
  }
  function close() {
    overlay.classList.remove('flex');
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
  }
  function isOpen() { return overlay.classList.contains('flex'); }

  function fmtPctSafe(v) {
    if (typeof v !== 'number' || isNaN(v)) return '';
    return (v * 100).toFixed(2) + '%';
  }

  function score(c, q) {
    if (!q) return 1;
    var t = c.ticker.toLowerCase();
    var n = (c.name || '').toLowerCase();
    if (t === q) return 1000;
    if (t.indexOf(q) === 0) return 500;
    if (t.indexOf(q) >= 0) return 200;
    if (n.indexOf(q) >= 0) return 50;
    var label = (c.categoryLabel || '').toLowerCase();
    if (label.indexOf(q) >= 0) return 20;
    return 0;
  }

  function render() {
    var q = input.value.trim().toLowerCase();
    var u = universe || [];
    var ranked = u
      .map(function(c) { return { c: c, s: score(c, q) }; })
      .filter(function(x) { return q === '' || x.s > 0; })
      .sort(function(a, b) {
        if (b.s !== a.s) return b.s - a.s;
        return a.c.ticker.localeCompare(b.c.ticker);
      })
      .slice(0, 30);
    lastFiltered = ranked.map(function(x) { return x.c; });
    if (highlight >= lastFiltered.length) highlight = Math.max(0, lastFiltered.length - 1);

    if (lastFiltered.length === 0) {
      results.innerHTML = '<li class="px-4 py-8 text-center text-sm text-slate-500">' +
        (q ? 'No tickers match “' + escapeHtml(q) + '”' : 'Loading universe…') +
        '</li>';
      return;
    }
    results.innerHTML = lastFiltered.map(function(c, i) {
      var kindBadge = c.kind === 'etf'
        ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono">ETF</span>'
        : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 font-mono">STOCK</span>';
      var hl = i === highlight ? 'bg-emerald-500/10' : '';
      return '<li data-index="' + i + '" class="dd-cmdk-item ' + hl + ' px-4 py-2.5 cursor-pointer flex items-center gap-3 hover:bg-emerald-500/10 border-b border-slate-800/40 last:border-0">' +
        '<span class="font-mono font-semibold text-slate-100 w-16 truncate">' + escapeHtml(c.ticker) + '</span>' +
        kindBadge +
        '<span class="text-sm text-slate-300 truncate flex-1">' + escapeHtml(c.name) + '</span>' +
        '<span class="text-[11px] text-slate-500 truncate hidden sm:inline">' + escapeHtml(c.categoryLabel || '') + '</span>' +
        '<span class="num text-xs text-emerald-300">' + escapeHtml(fmtPctSafe(c.forwardYield)) + '</span>' +
        '</li>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function pick(i) {
    var c = lastFiltered[i];
    if (!c) return;
    close();
    window.location.href = '/ticker/' + encodeURIComponent(c.ticker);
  }

  // Event wiring
  if (trigger) trigger.addEventListener('click', open);
  document.addEventListener('keydown', function(e) {
    var meta = e.metaKey || e.ctrlKey;
    var inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
    if (meta && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (e.key === '/' && !inField && !isOpen()) {
      e.preventDefault();
      open();
      return;
    }
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight = Math.min(lastFiltered.length - 1, highlight + 1); render(); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); highlight = Math.max(0, highlight - 1); render(); return; }
    if (e.key === 'Enter')     { e.preventDefault(); pick(highlight); return; }
  });
  input.addEventListener('input', function() { highlight = 0; render(); });
  results.addEventListener('click', function(e) {
    var li = e.target && e.target.closest('li.dd-cmdk-item');
    if (!li) return;
    pick(parseInt(li.getAttribute('data-index'), 10));
  });
  overlay.addEventListener('click', function(e) {
    var t = e.target;
    if (t && t.getAttribute && t.getAttribute('data-cmdk-close') !== null) close();
  });
})();
`;

/**
 * Chart.js color palette resolver — used by every chart in every view.
 * Reads the currently resolved theme and returns matched colors.
 *
 * Chart instances are constructed once and live until the next page reload,
 * so reading at construction time is sufficient.
 */
const CHART_THEME_HELPER = `
window.__chartTheme = function() {
  var isLight = document.documentElement.getAttribute('data-resolved-theme') === 'light';
  if (isLight) {
    return {
      isLight: true,
      text: '#475569',                                // axis labels
      grid: 'rgba(15, 23, 36, 0.06)',                 // weak gridlines
      gridStrong: 'rgba(15, 23, 36, 0.10)',           // stronger axis lines
      tooltipBg: 'rgba(255, 255, 255, 0.97)',
      tooltipText: '#0f172a',
      tooltipBody: '#334155',
      tooltipBorder: 'rgba(5, 150, 105, 0.45)',
      legend: '#334155',
      // Series colors — slightly darker than dark-mode equivalents for AA
      // contrast on white backgrounds
      emerald: '#059669',
      emeraldFill: 'rgba(5, 150, 105, 0.16)',
      emeraldDot: '#059669',
      cyan: '#0891b2',
      cyanFill: 'rgba(8, 145, 178, 0.14)',
    };
  }
  return {
    isLight: false,
    text: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.05)',
    gridStrong: 'rgba(148, 163, 184, 0.10)',
    tooltipBg: 'rgba(15, 23, 36, 0.95)',
    tooltipText: '#e2e8f0',
    tooltipBody: '#cbd5e1',
    tooltipBorder: 'rgba(52, 211, 153, 0.4)',
    legend: '#cbd5e1',
    emerald: 'rgb(52, 211, 153)',
    emeraldFill: 'rgba(52, 211, 153, 0.18)',
    emeraldDot: 'rgb(52, 211, 153)',
    cyan: 'rgb(34, 211, 238)',
    cyanFill: 'rgba(34, 211, 238, 0.10)',
  };
};
`;

/**
 * The big one — light-mode overrides for the dark-first Tailwind classes
 * scattered across every view. Targets `[data-resolved-theme="light"]` so
 * the original dark look is the unmodified baseline.
 *
 * Strategy: remap the small set of slate utilities + glass surfaces +
 * accent colors actually used by the views. Anything not listed stays as
 * Tailwind originally generated it.
 */
const LIGHT_OVERRIDES_CSS = `
:root {
  color-scheme: dark;
}
:root[data-resolved-theme="light"] {
  color-scheme: light;
}

/* === Body / background === */
body {
  background:
    radial-gradient(1200px 800px at 10% -10%, rgba(16,185,129,0.07), transparent),
    radial-gradient(1000px 700px at 110% 0%, rgba(99,102,241,0.06), transparent),
    #0b0f17;
  min-height: 100vh;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
}
[data-resolved-theme="light"] body {
  background:
    radial-gradient(1200px 800px at 10% -10%, rgba(16,185,129,0.10), transparent),
    radial-gradient(1000px 700px at 110% 0%, rgba(99,102,241,0.08), transparent),
    #f6f7fb;
  color: #0f172a;
}

/* === Glass surfaces === */
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
[data-resolved-theme="light"] .glass {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(15, 23, 36, 0.06);
  box-shadow: 0 1px 2px rgba(15, 23, 36, 0.04), 0 4px 16px -8px rgba(15, 23, 36, 0.06);
}
[data-resolved-theme="light"] .glass-strong {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(15, 23, 36, 0.08);
  box-shadow: 0 1px 3px rgba(15, 23, 36, 0.05), 0 8px 32px -12px rgba(15, 23, 36, 0.08);
}

/* === Numeric font-feature === */
.num {
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
}

/* === Sustainability score badge === */
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

/* === Ticker card hover === */
.ticker-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}
.ticker-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px -12px rgba(16, 185, 129, 0.25);
  border-color: rgba(16, 185, 129, 0.35);
}
[data-resolved-theme="light"] .ticker-card:hover {
  box-shadow: 0 8px 28px -10px rgba(5, 150, 105, 0.30);
  border-color: rgba(5, 150, 105, 0.45);
}

.sparkline { height: 32px; width: 100%; }

/* === Scrollbar === */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: rgba(15,23,36,0.4); }
::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.4); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.6); }
[data-resolved-theme="light"] ::-webkit-scrollbar-track { background: rgba(15, 23, 36, 0.04); }
[data-resolved-theme="light"] ::-webkit-scrollbar-thumb { background: rgba(15, 23, 36, 0.18); }
[data-resolved-theme="light"] ::-webkit-scrollbar-thumb:hover { background: rgba(15, 23, 36, 0.28); }

/* === LIGHT MODE TAILWIND-CLASS REMAPS ===
 * Every slate text / bg / border class actually used by the views,
 * plus accent text colors that need a darker shade on white for
 * AA contrast. Only need !important on the simple class overrides
 * because Tailwind's CDN puts its rules at low specificity already.
 */
[data-resolved-theme="light"] .text-slate-50,
[data-resolved-theme="light"] .text-slate-100,
[data-resolved-theme="light"] .text-slate-200 { color: #0f172a !important; }
[data-resolved-theme="light"] .text-slate-300 { color: #1e293b !important; }
[data-resolved-theme="light"] .text-slate-400 { color: #475569 !important; }
[data-resolved-theme="light"] .text-slate-500 { color: #64748b !important; }

[data-resolved-theme="light"] .bg-slate-800 { background-color: #e2e8f0 !important; }
[data-resolved-theme="light"] .bg-slate-900 { background-color: #ffffff !important; }
[data-resolved-theme="light"] .bg-slate-950 { background-color: #f6f7fb !important; }
[data-resolved-theme="light"] .bg-slate-800\\/30 { background-color: rgba(15, 23, 36, 0.04) !important; }
[data-resolved-theme="light"] .bg-slate-800\\/60 { background-color: rgba(15, 23, 36, 0.06) !important; }
[data-resolved-theme="light"] .bg-slate-900\\/40 { background-color: #ffffff !important; }
[data-resolved-theme="light"] .bg-slate-900\\/60 { background-color: #ffffff !important; }
[data-resolved-theme="light"] .hover\\:bg-slate-800:hover { background-color: #cbd5e1 !important; }
[data-resolved-theme="light"] .hover\\:bg-slate-800\\/30:hover { background-color: rgba(15, 23, 36, 0.05) !important; }

[data-resolved-theme="light"] .border-slate-700 { border-color: #cbd5e1 !important; }
[data-resolved-theme="light"] .border-slate-800 { border-color: #e2e8f0 !important; }
[data-resolved-theme="light"] .border-slate-800\\/40 { border-color: rgba(15, 23, 36, 0.08) !important; }
[data-resolved-theme="light"] .border-slate-800\\/60 { border-color: rgba(15, 23, 36, 0.10) !important; }
[data-resolved-theme="light"] .border-slate-800\\/70 { border-color: rgba(15, 23, 36, 0.12) !important; }

/* Accent text — darken for AA contrast on white */
[data-resolved-theme="light"] .text-emerald-300,
[data-resolved-theme="light"] .text-emerald-400 { color: #059669 !important; }
[data-resolved-theme="light"] .text-cyan-300,
[data-resolved-theme="light"] .text-cyan-400 { color: #0891b2 !important; }
[data-resolved-theme="light"] .text-amber-300,
[data-resolved-theme="light"] .text-amber-400 { color: #b45309 !important; }
[data-resolved-theme="light"] .text-amber-300\\/90 { color: rgba(180, 83, 9, 0.92) !important; }
[data-resolved-theme="light"] .text-rose-400 { color: #e11d48 !important; }
[data-resolved-theme="light"] .text-orange-400 { color: #c2410c !important; }
[data-resolved-theme="light"] .text-lime-400 { color: #4d7c0f !important; }
[data-resolved-theme="light"] .text-violet-300 { color: #6d28d9 !important; }

/* Accent backgrounds (filter pills, badges) */
[data-resolved-theme="light"] .bg-emerald-500\\/20 { background-color: rgba(5, 150, 105, 0.15) !important; }
[data-resolved-theme="light"] .bg-emerald-500\\/30 { background-color: rgba(5, 150, 105, 0.22) !important; }
[data-resolved-theme="light"] .bg-emerald-500\\/5 { background-color: rgba(5, 150, 105, 0.04) !important; }
[data-resolved-theme="light"] .bg-cyan-500\\/15 { background-color: rgba(8, 145, 178, 0.14) !important; }
[data-resolved-theme="light"] .bg-cyan-500\\/5 { background-color: rgba(8, 145, 178, 0.04) !important; }
[data-resolved-theme="light"] .bg-violet-500\\/15 { background-color: rgba(109, 40, 217, 0.13) !important; }
[data-resolved-theme="light"] .border-emerald-500\\/40 { border-color: rgba(5, 150, 105, 0.45) !important; }
[data-resolved-theme="light"] .border-emerald-500\\/30 { border-color: rgba(5, 150, 105, 0.35) !important; }
[data-resolved-theme="light"] .border-cyan-500\\/30 { border-color: rgba(8, 145, 178, 0.35) !important; }
[data-resolved-theme="light"] .focus\\:border-emerald-500:focus { border-color: #059669 !important; }
[data-resolved-theme="light"] .hover\\:border-emerald-500\\/40:hover { border-color: rgba(5, 150, 105, 0.45) !important; }
[data-resolved-theme="light"] .hover\\:border-emerald-500\\/60:hover { border-color: rgba(5, 150, 105, 0.6) !important; }
[data-resolved-theme="light"] .hover\\:text-emerald-400:hover { color: #047857 !important; }
[data-resolved-theme="light"] .hover\\:text-rose-400:hover { color: #be123c !important; }

/* Placeholder text */
[data-resolved-theme="light"] .placeholder\\:text-slate-500::placeholder { color: #94a3b8 !important; }

/* Active nav link border */
[data-resolved-theme="light"] .border-emerald-400 { border-color: #059669 !important; }
[data-resolved-theme="light"] .hover\\:text-slate-100:hover { color: #0f172a !important; }
[data-resolved-theme="light"] .hover\\:border-slate-600:hover { border-color: #cbd5e1 !important; }

/* === Theme toggle (segmented control) === */
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 9999px;
  background: rgba(15, 23, 36, 0.5);
  border: 1px solid rgba(148, 163, 184, 0.10);
}
[data-resolved-theme="light"] .theme-toggle {
  background: rgba(15, 23, 36, 0.04);
  border: 1px solid rgba(15, 23, 36, 0.08);
}
.theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  color: #64748b;
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: color 0.12s ease, background-color 0.12s ease;
}
.theme-btn:hover { color: #cbd5e1; }
[data-resolved-theme="light"] .theme-btn:hover { color: #1e293b; }
.theme-btn.theme-btn-active {
  color: #0b0f17;
  background: #34d399;
}
[data-resolved-theme="light"] .theme-btn.theme-btn-active {
  color: #ffffff;
  background: #059669;
}
.theme-btn svg { width: 14px; height: 14px; }
`;

function renderThemeToggle(): string {
  // Three options: light / light-dark (auto) / dark
  return `
  <div class="theme-toggle" role="group" aria-label="Theme">
    <button type="button" class="theme-btn" data-theme-set="light" aria-pressed="false" title="Light theme">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4"/>
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    </button>
    <button type="button" class="theme-btn" data-theme-set="light-dark" aria-pressed="false" title="Auto (follow OS)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/>
        <path d="M12 3v18" />
        <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
      </svg>
    </button>
    <button type="button" class="theme-btn" data-theme-set="dark" aria-pressed="false" title="Dark theme">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"/>
      </svg>
    </button>
  </div>`;
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} · dividend-dash</title>
<script>${PREPAINT_SCRIPT}</script>
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
<script>${CHART_THEME_HELPER}</script>
<style>${LIGHT_OVERRIDES_CSS}</style>
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
        <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">v0.4</span>
      </a>
      <nav class="flex items-center gap-0">${navHtml}</nav>
      <div class="flex-1"></div>
      <button
        type="button"
        id="dd-cmdk-trigger"
        class="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
        aria-label="Open command palette"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 opacity-70"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span class="hidden md:inline">Search ticker</span>
        <kbd class="hidden md:inline ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800/70 text-slate-400 border border-slate-700">⌘K</kbd>
      </button>
      ${renderThemeToggle()}
    </div>
  </header>

  <!-- Command palette -->
  <div id="dd-cmdk" class="dd-cmdk hidden fixed inset-0 z-50 items-start justify-center pt-24 px-4" role="dialog" aria-modal="true" aria-label="Ticker search">
    <div class="dd-cmdk-backdrop absolute inset-0 bg-slate-950/70 backdrop-blur-sm" data-cmdk-close></div>
    <div class="relative w-full max-w-xl rounded-2xl glass-strong border border-slate-700/60 shadow-2xl overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-800/60">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 text-slate-500"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          id="dd-cmdk-input"
          type="text"
          placeholder="Search by ticker or name (try SCHD, JNJ, dividend kings)…"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          class="flex-1 bg-transparent text-base text-slate-100 placeholder:text-slate-500 focus:outline-none"
        >
        <kbd class="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700">esc</kbd>
      </div>
      <ul id="dd-cmdk-results" class="max-h-[60vh] overflow-y-auto"></ul>
      <div class="px-4 py-2 border-t border-slate-800/60 text-[11px] text-slate-500 flex items-center justify-between">
        <span><kbd class="font-mono text-slate-400">↑↓</kbd> navigate · <kbd class="font-mono text-slate-400">↵</kbd> open</span>
        <span class="num">v0.4</span>
      </div>
    </div>
  </div>

  <main class="max-w-7xl mx-auto px-6 py-8">
    ${opts.body}
  </main>

  <footer class="max-w-7xl mx-auto px-6 py-12 text-center text-slate-500 text-xs border-t border-slate-800/40 mt-12">
    <p>dividend-dash · personal dividend research · not financial advice</p>
    <p class="mt-1">Data: Yahoo Finance &amp; SEC EDGAR · refreshed manually via <code class="text-slate-400">bun run seed-universe</code></p>
  </footer>

  ${opts.footerScripts ?? ''}
  <script>${THEME_RUNTIME_SCRIPT}</script>
  <script>${CMDK_RUNTIME_SCRIPT}</script>
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
