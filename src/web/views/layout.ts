/**
 * Shared HTML layout. All pages render through this.
 *
 * v0.6 cleanup pass. See DESIGN.md for the full reference.
 *
 * What changed in v0.6:
 *   - Dropped page-background radial gradients (the "AI dashboard glow").
 *   - Lower-contrast surfaces, hairline borders. Resting cards have no
 *     shadow; hover does the talking.
 *   - Simpler header: solid-fill brand mark (no gradient), no version
 *     pill, slimmer height.
 *   - Single accent (emerald). Amber retired from decoration; reserved
 *     for warnings.
 *   - More generous vertical rhythm (`space-y-10` between sections).
 *   - New utility class `.ticker-row` for the dashboard browse table.
 *   - Existing classes preserved: .kpi, .delta, .data-table, .section-h,
 *     .grade-*, .pill, .ticker-card, .hero-quote, .anchor-ribbon.
 */

export interface LayoutOpts {
  title: string;
  active: 'dashboard' | 'compare' | 'calendar' | 'ticker';
  body: string;
  /** Extra <head> entries (per-page scripts, e.g. embedded JSON). */
  head?: string;
  /** Extra footer scripts to run after body. */
  footerScripts?: string;
  /** Optional "as of" line in the header for data freshness. */
  asOf?: string | null;
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
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-resolved-theme', 'dark');
    document.documentElement.classList.add('dark');
  }
})();
`;

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
    if (opts && opts.reloadOnSwap && prev && prev !== next) {
      window.location.reload();
    }
  }
  var btns = document.querySelectorAll('[data-theme-set]');
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      btn.addEventListener('click', function() {
        var pref = btn.getAttribute('data-theme-set');
        apply(pref, { reloadOnSwap: true });
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
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var mqListener = function() {
    var pref = root.getAttribute('data-theme');
    if (pref === 'light-dark') apply('light-dark', { reloadOnSwap: true });
  };
  if (mq.addEventListener) mq.addEventListener('change', mqListener);
  else if (mq.addListener) mq.addListener(mqListener);
})();
`;

const CMDK_RUNTIME_SCRIPT = `
(function() {
  var overlay = document.getElementById('dd-cmdk');
  var input = document.getElementById('dd-cmdk-input');
  var results = document.getElementById('dd-cmdk-results');
  var trigger = document.getElementById('dd-cmdk-trigger');
  if (!overlay || !input || !results) return;

  var universe = null;
  var highlight = 0;
  var lastFiltered = [];
  var loadPromise = null;

  function ensureUniverse() {
    if (universe) return Promise.resolve(universe);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('/api/universe').then(function(r) { return r.json(); }).then(function(data) {
      universe = (Array.isArray(data) ? data : []).map(function(c) {
        return {
          ticker: c.ticker, name: c.name, kind: c.kind,
          categoryLabel: c.categoryLabel, forwardYield: c.forwardYield,
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
    var ranked = u.map(function(c) { return { c: c, s: score(c, q) }; })
      .filter(function(x) { return q === '' || x.s > 0; })
      .sort(function(a, b) {
        if (b.s !== a.s) return b.s - a.s;
        return a.c.ticker.localeCompare(b.c.ticker);
      })
      .slice(0, 30);
    lastFiltered = ranked.map(function(x) { return x.c; });
    if (highlight >= lastFiltered.length) highlight = Math.max(0, lastFiltered.length - 1);

    if (lastFiltered.length === 0) {
      results.innerHTML = '<li class="px-4 py-8 text-center text-sm muted">' +
        (q ? 'No tickers match "' + escapeHtml(q) + '"' : 'Loading universe…') + '</li>';
      return;
    }
    results.innerHTML = lastFiltered.map(function(c, i) {
      var kindBadge = c.kind === 'etf'
        ? '<span class="pill pill-cyan">ETF</span>'
        : '<span class="pill pill-violet">STOCK</span>';
      var hl = i === highlight ? 'is-highlighted' : '';
      return '<li data-index="' + i + '" class="dd-cmdk-item ' + hl + '">' +
        '<span class="font-mono font-semibold text-base mr-3 w-16 truncate">' + escapeHtml(c.ticker) + '</span>' +
        kindBadge +
        '<span class="text-sm flex-1 truncate ml-3">' + escapeHtml(c.name) + '</span>' +
        '<span class="text-[11px] muted truncate hidden sm:inline mr-3">' + escapeHtml(c.categoryLabel || '') + '</span>' +
        '<span class="num text-xs accent-text">' + escapeHtml(fmtPctSafe(c.forwardYield)) + '</span>' +
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

const CHART_THEME_HELPER = `
window.__chartTheme = function() {
  var isLight = document.documentElement.getAttribute('data-resolved-theme') === 'light';
  if (isLight) {
    return {
      isLight: true,
      text: '#475569',
      grid: 'rgba(15, 23, 36, 0.06)',
      gridStrong: 'rgba(15, 23, 36, 0.10)',
      tooltipBg: 'rgba(255, 255, 255, 0.97)',
      tooltipText: '#0a0d14',
      tooltipBody: '#1f2937',
      tooltipBorder: 'rgba(5, 150, 105, 0.45)',
      legend: '#1f2937',
      emerald: '#059669',
      emeraldFill: 'rgba(5, 150, 105, 0.12)',
      emeraldDot: '#059669',
      cyan: '#0891b2',
      cyanFill: 'rgba(8, 145, 178, 0.10)',
      amber: '#b45309',
      amberFill: 'rgba(180, 83, 9, 0.12)',
      rose: '#be123c',
      roseFill: 'rgba(190, 18, 60, 0.10)',
      violet: '#7c3aed',
      lime: '#65a30d',
      // 12-color sector palette (light)
      sector: ['#059669','#0891b2','#7c3aed','#b45309','#be123c','#2563eb','#db2777','#65a30d','#c2410c','#475569','#ca8a04','#0d9488'],
    };
  }
  return {
    isLight: false,
    text: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.05)',
    gridStrong: 'rgba(148, 163, 184, 0.10)',
    tooltipBg: 'rgba(15, 23, 36, 0.95)',
    tooltipText: '#f1f5f9',
    tooltipBody: '#cbd5e1',
    tooltipBorder: 'rgba(52, 211, 153, 0.4)',
    legend: '#cbd5e1',
    emerald: '#34d399',
    emeraldFill: 'rgba(52, 211, 153, 0.16)',
    emeraldDot: '#34d399',
    cyan: '#22d3ee',
    cyanFill: 'rgba(34, 211, 238, 0.10)',
    amber: '#fbbf24',
    amberFill: 'rgba(251, 191, 36, 0.14)',
    rose: '#fb7185',
    roseFill: 'rgba(251, 113, 133, 0.10)',
    violet: '#a78bfa',
    lime: '#a3e635',
    // 12-color sector palette (dark)
    sector: ['#34d399','#22d3ee','#a78bfa','#fbbf24','#fb7185','#60a5fa','#f472b6','#a3e635','#fb923c','#94a3b8','#facc15','#2dd4bf'],
  };
};
`;

/**
 * Big stylesheet — the new design system.
 * Variables drive both themes; components target the variables.
 */
const DESIGN_CSS = `
:root {
  color-scheme: dark;
  /* dark palette — v0.6: quieter, lower-contrast surfaces */
  --bg: #0a0d14;
  --bg-elev: #0e1218;
  --surface: #11151e;
  --surface-2: #161b22;
  --rule: rgba(148, 163, 184, 0.08);
  --rule-strong: rgba(148, 163, 184, 0.16);
  --ink: #f1f5f9;
  --ink-2: #e2e8f0;
  --ink-3: #cbd5e1;
  --ink-muted: #94a3b8;
  --ink-faint: #64748b;
  --accent: #34d399;
  --accent-2: #fbbf24; /* warning only */
  --positive: #4ade80;
  --negative: #f87171;
  --neutral: #94a3b8;
  /* shadows — used only on hover, never at rest */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.20);
  --shadow-md: 0 4px 16px -6px rgba(0,0,0,0.30);
  --shadow-glow: 0 6px 24px -10px rgba(52, 211, 153, 0.22);
}
:root[data-resolved-theme="light"] {
  color-scheme: light;
  --bg: #fafaf6;
  --bg-elev: #ffffff;
  --surface: #ffffff;
  --surface-2: #f3f2ec;
  --rule: rgba(15, 23, 36, 0.06);
  --rule-strong: rgba(15, 23, 36, 0.12);
  --ink: #0a0d14;
  --ink-2: #1f2937;
  --ink-3: #334155;
  --ink-muted: #475569;
  --ink-faint: #64748b;
  --accent: #059669;
  --accent-2: #b45309;
  --positive: #047857;
  --negative: #be123c;
  --neutral: #64748b;
  --shadow-sm: 0 1px 2px rgba(15,23,36,0.04);
  --shadow-md: 0 1px 3px rgba(15,23,36,0.05), 0 8px 20px -12px rgba(15,23,36,0.08);
  --shadow-glow: 0 6px 22px -10px rgba(5, 150, 105, 0.22);
}

* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  background: var(--bg);
  min-height: 100vh;
  color: var(--ink-2);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  font-feature-settings: 'cv11', 'ss01', 'ss03';
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  line-height: 1.55;
}

/* === Type === */
.display { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; font-weight: 600; letter-spacing: -0.015em; }
.editorial { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; font-weight: 600; }
.num, .mono, kbd { font-family: 'JetBrains Mono', ui-monospace, SF Mono, Menlo, monospace; font-feature-settings: 'tnum', 'zero'; font-variant-numeric: tabular-nums; }
.label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  font-feature-settings: 'cv11';
  line-height: 1.4;
}
.muted { color: var(--ink-muted); }
.faint { color: var(--ink-faint); }
.ink { color: var(--ink); }
.ink-2 { color: var(--ink-2); }
.ink-3 { color: var(--ink-3); }
.accent-text { color: var(--accent); }
.accent-2-text { color: var(--accent-2); }
.positive { color: var(--positive); }
.negative { color: var(--negative); }

/* === Surfaces === */
.surface {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
}
.surface-2 {
  background: var(--surface-2);
  border: 1px solid var(--rule);
  border-radius: 12px;
}
.elevated { box-shadow: var(--shadow-md); }
.glass {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
}
.glass-strong {
  background: var(--bg-elev);
  border-bottom: 1px solid var(--rule-strong);
  backdrop-filter: blur(8px);
}
[data-resolved-theme="dark"] .glass-strong { background: rgba(15, 19, 28, 0.85); }

/* === Section header === */
.section-h {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.625rem;
  border-bottom: 1px solid var(--rule);
}
.section-h .label { font-size: 10.5px; }
.section-h h2 {
  font-family: 'Source Serif 4', Georgia, serif;
  font-weight: 600;
  font-size: 1.125rem;
  color: var(--ink);
  letter-spacing: -0.01em;
}

/* === KPI tile === */
.kpi {
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  padding: 18px 20px;
  position: relative;
  overflow: hidden;
}
.kpi .label { display: block; margin-bottom: 8px; }
.kpi .value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
  font-size: 1.875rem;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.kpi .sub {
  font-size: 11.5px;
  color: var(--ink-muted);
  margin-top: 6px;
  letter-spacing: 0.01em;
  line-height: 1.45;
}
.kpi.kpi-lg .value { font-size: 2.5rem; }
.kpi.kpi-bare {
  background: transparent;
  border: 0;
  padding: 0;
}

/* === Quote hero === */
.hero-quote {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: end;
  padding: 24px 24px 18px;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}
.hero-quote .symbol {
  font-family: 'Source Serif 4', Georgia, serif;
  font-weight: 600;
  font-size: 3rem;
  color: var(--ink);
  letter-spacing: -0.025em;
  line-height: 1;
}
.hero-quote .price {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
  font-size: 2.75rem;
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
  text-align: right;
  letter-spacing: -0.02em;
}

/* === Delta chip === */
.delta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'JetBrains Mono', monospace;
  font-feature-settings: 'tnum';
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.10);
  color: var(--neutral);
}
.delta-pos { background: rgba(74, 222, 128, 0.14); color: var(--positive); }
.delta-neg { background: rgba(248, 113, 113, 0.14); color: var(--negative); }
[data-resolved-theme="light"] .delta-pos { background: rgba(4, 120, 87, 0.10); color: var(--positive); }
[data-resolved-theme="light"] .delta-neg { background: rgba(190, 18, 60, 0.10); color: var(--negative); }
.delta-lg { font-size: 14px; padding: 4px 10px; }

/* === Pills (badges) === */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.pill-cyan   { background: rgba(34,211,238,0.12); color: #22d3ee; }
.pill-violet { background: rgba(167,139,250,0.14); color: #a78bfa; }
.pill-emerald{ background: rgba(52,211,153,0.14); color: var(--accent); }
.pill-amber  { background: rgba(251,191,36,0.14); color: var(--accent-2); }
.pill-rose   { background: rgba(248,113,113,0.12); color: var(--negative); }
.pill-slate  { background: rgba(148,163,184,0.10); color: var(--ink-muted); }
[data-resolved-theme="light"] .pill-cyan   { background: rgba(8,145,178,0.10); color: #0891b2; }
[data-resolved-theme="light"] .pill-violet { background: rgba(124,58,237,0.10); color: #6d28d9; }
[data-resolved-theme="light"] .pill-emerald{ background: rgba(5,150,105,0.10); color: var(--accent); }
[data-resolved-theme="light"] .pill-amber  { background: rgba(180,83,9,0.10); color: var(--accent-2); }

/* === Grade badge (A+/A/B/C/D/F) === */
.grade {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  font-family: 'Source Serif 4', Georgia, serif;
  font-weight: 700;
  font-size: 17px;
  letter-spacing: -0.02em;
  background: var(--surface-2);
  border: 1px solid var(--rule);
}
.grade-A { background: rgba(74,222,128,0.16); color: var(--positive); border-color: rgba(74,222,128,0.30); }
.grade-B { background: rgba(163,230,53,0.16); color: #a3e635; border-color: rgba(163,230,53,0.30); }
.grade-C { background: rgba(251,191,36,0.16); color: var(--accent-2); border-color: rgba(251,191,36,0.30); }
.grade-D { background: rgba(251,146,60,0.16); color: #fb923c; border-color: rgba(251,146,60,0.30); }
.grade-F { background: rgba(248,113,113,0.16); color: var(--negative); border-color: rgba(248,113,113,0.30); }
[data-resolved-theme="light"] .grade-A { color: var(--positive); background: rgba(4,120,87,0.10); border-color: rgba(4,120,87,0.30); }
[data-resolved-theme="light"] .grade-B { color: #4d7c0f; background: rgba(101,163,13,0.10); border-color: rgba(101,163,13,0.30); }
[data-resolved-theme="light"] .grade-C { color: var(--accent-2); background: rgba(180,83,9,0.10); border-color: rgba(180,83,9,0.30); }
[data-resolved-theme="light"] .grade-D { color: #c2410c; background: rgba(194,65,12,0.10); border-color: rgba(194,65,12,0.30); }
[data-resolved-theme="light"] .grade-F { color: var(--negative); background: rgba(190,18,60,0.10); border-color: rgba(190,18,60,0.30); }

.grade-lg { width: 56px; height: 56px; font-size: 26px; border-radius: 12px; }

/* === Data tables === */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.data-table thead th {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  text-align: left;
  padding: 11px 12px;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  white-space: nowrap;
}
.data-table thead th.text-right { text-align: right; }
.data-table thead th.text-center { text-align: center; }
.data-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-2);
  vertical-align: middle;
}
.data-table tbody tr:hover td { background: rgba(148,163,184,0.05); }
[data-resolved-theme="light"] .data-table tbody tr:hover td { background: rgba(15,23,36,0.025); }
.data-table .num-cell { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; text-align: right; }
.data-table .ticker-cell { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--ink); }
.data-table tbody tr:last-child td { border-bottom: 0; }

/* === Buttons === */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 7px 12px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-2);
  border: 1px solid var(--rule);
  cursor: pointer;
  transition: all 120ms ease;
  text-decoration: none;
}
.btn:hover { border-color: var(--rule-strong); color: var(--ink); }
.btn-accent {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
  font-weight: 600;
}
[data-resolved-theme="light"] .btn-accent { color: white; }
.btn-accent:hover { filter: brightness(1.06); }
.btn-ghost { background: transparent; }

/* === Filter chip === */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: all 100ms ease;
}
.chip:hover { color: var(--ink); border-color: var(--rule-strong); }
.chip.is-active {
  background: rgba(52,211,153,0.14);
  color: var(--accent);
  border-color: rgba(52,211,153,0.40);
}
[data-resolved-theme="light"] .chip.is-active {
  background: rgba(5,150,105,0.10);
  color: var(--accent);
  border-color: rgba(5,150,105,0.45);
}
.chip .count { color: var(--ink-faint); margin-left: 4px; font-feature-settings: 'tnum'; }

/* === Inputs === */
.input, select.input {
  background: var(--surface-2);
  border: 1px solid var(--rule);
  color: var(--ink);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
  transition: border-color 100ms ease;
  font-family: 'Inter', sans-serif;
}
.input:focus { border-color: var(--accent); }
.input::placeholder { color: var(--ink-faint); }

/* === Ticker card grid === */
.ticker-card {
  display: block;
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  padding: 16px;
  text-decoration: none;
  color: var(--ink-2);
  transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
}
.ticker-card:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-glow);
  border-color: rgba(52, 211, 153, 0.32);
}
[data-resolved-theme="light"] .ticker-card:hover { border-color: rgba(5, 150, 105, 0.36); }

/* === Ticker row (inline list, default browse view in v0.6) === */
.ticker-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}
.ticker-table thead th {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
  text-align: left;
  padding: 12px 14px;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
  background: transparent;
  position: sticky; top: 56px; z-index: 5;
  background: var(--bg);
}
.ticker-table thead th.right { text-align: right; }
.ticker-table tbody td {
  padding: 13px 14px;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-2);
  vertical-align: middle;
}
.ticker-table tbody tr {
  transition: background-color 100ms ease;
  cursor: pointer;
}
.ticker-table tbody tr:hover td { background: rgba(52,211,153,0.04); }
[data-resolved-theme="light"] .ticker-table tbody tr:hover td { background: rgba(5,150,105,0.04); }
.ticker-table .num-cell { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; text-align: right; }
.ticker-table .ticker-cell { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.ticker-table tbody tr:last-child td { border-bottom: 0; }
.ticker-table .name-cell { color: var(--ink-3); max-width: 0; }
.ticker-table .name-cell .name { display: block; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ticker-table .name-cell .cat { font-size: 10.5px; color: var(--ink-muted); margin-top: 1px; letter-spacing: 0.04em; text-transform: uppercase; }
.ticker-table .grade-cell { width: 32px; }
.ticker-table .grade-cell .grade { width: 28px; height: 28px; font-size: 13px; border-radius: 6px; }
.ticker-table .spark-cell { width: 90px; opacity: 0.85; }
.ticker-table .spark-cell canvas { height: 22px; width: 100%; display: block; }

/* sparkline canvas wrappers */
.sparkline { height: 28px; width: 100%; display: block; }
.sparkline-md { height: 56px; }
.sparkline-lg { height: 80px; }

/* mini bar */
.bar-track {
  height: 6px;
  background: var(--surface-2);
  border-radius: 999px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
}

/* === Header === */
.app-header {
  position: sticky; top: 0; z-index: 30;
}
.app-header .brand-mark {
  width: 26px; height: 26px;
  border-radius: 7px;
  background: var(--accent);
  display: flex; align-items: center; justify-content: center;
  color: var(--bg);
  font-weight: 700;
}
[data-resolved-theme="light"] .app-header .brand-mark { color: #ffffff; }
.app-header nav a {
  display: inline-flex; align-items: center;
  padding: 16px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-muted);
  border-bottom: 2px solid transparent;
  text-decoration: none;
  transition: color 100ms ease, border-color 100ms ease;
  letter-spacing: -0.005em;
}
.app-header nav a:hover { color: var(--ink); }
.app-header nav a.is-active {
  color: var(--ink);
  border-bottom-color: var(--accent);
}

.search-trigger {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px;
  color: var(--ink-muted);
  background: var(--surface-2);
  border: 1px solid var(--rule);
  padding: 7px 11px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 120ms ease;
  min-width: 220px;
}
.search-trigger:hover { color: var(--ink); border-color: var(--rule-strong); }
.search-trigger kbd {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--rule);
  color: var(--ink-muted);
  font-family: 'JetBrains Mono', monospace;
}

/* Theme toggle */
.theme-toggle {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--rule);
}
.theme-btn {
  width: 26px; height: 26px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 999px;
  color: var(--ink-faint);
  background: transparent; border: 0;
  cursor: pointer;
  transition: color 100ms ease, background-color 100ms ease;
}
.theme-btn:hover { color: var(--ink-2); }
.theme-btn.theme-btn-active { color: var(--bg); background: var(--accent); }
[data-resolved-theme="light"] .theme-btn.theme-btn-active { color: white; background: var(--accent); }
.theme-btn svg { width: 13px; height: 13px; }

/* Cmd+K palette */
.dd-cmdk-backdrop { background: rgba(10, 13, 20, 0.72); backdrop-filter: blur(4px); }
[data-resolved-theme="light"] .dd-cmdk-backdrop { background: rgba(15, 23, 36, 0.30); }
.dd-cmdk-panel {
  background: var(--bg-elev);
  border: 1px solid var(--rule-strong);
  border-radius: 14px;
  box-shadow: 0 20px 60px -10px rgba(0,0,0,0.45);
}
.dd-cmdk-item {
  display: flex; align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid var(--rule);
  color: var(--ink-2);
}
.dd-cmdk-item:last-child { border-bottom: 0; }
.dd-cmdk-item.is-highlighted, .dd-cmdk-item:hover {
  background: rgba(52,211,153,0.08);
  color: var(--ink);
}
[data-resolved-theme="light"] .dd-cmdk-item.is-highlighted,
[data-resolved-theme="light"] .dd-cmdk-item:hover { background: rgba(5,150,105,0.06); }

/* Footer */
.app-footer {
  border-top: 1px solid var(--rule);
  margin-top: 4rem;
  padding: 32px 0;
  text-align: center;
  font-size: 12px;
  color: var(--ink-faint);
}

/* Scrollbar */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--rule-strong); border-radius: 6px; border: 2px solid transparent; background-clip: padding-box; }
::-webkit-scrollbar-thumb:hover { background: var(--ink-faint); border: 2px solid transparent; background-clip: padding-box; }

/* Anchor ribbon (ticker page sub-nav) */
.anchor-ribbon {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 1.5rem;
  overflow-x: auto;
}
.anchor-ribbon a {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-muted);
  padding: 10px 14px;
  border-bottom: 2px solid transparent;
  text-decoration: none;
  white-space: nowrap;
  transition: color 100ms ease, border-color 100ms ease;
}
.anchor-ribbon a:hover { color: var(--ink); }
.anchor-ribbon a.is-active { color: var(--ink); border-bottom-color: var(--accent); }

/* Mini visualisations */
.mini-bars {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 2px;
  align-items: end;
  height: 32px;
}
.mini-bars .bar {
  background: rgba(52,211,153,0.55);
  border-radius: 1px;
  min-height: 2px;
}
[data-resolved-theme="light"] .mini-bars .bar { background: rgba(5,150,105,0.55); }

/* 52-week price meter */
.range-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(to right, rgba(248,113,113,0.5), rgba(251,191,36,0.5), rgba(74,222,128,0.55));
}
.range-marker {
  position: absolute;
  top: -3px;
  width: 12px; height: 12px;
  margin-left: -6px;
  border-radius: 50%;
  background: var(--ink);
  border: 2px solid var(--bg);
  box-shadow: 0 0 0 1px var(--rule-strong);
}

/* News card */
.news-item {
  padding: 12px 14px;
  border: 1px solid var(--rule);
  border-radius: 10px;
  background: var(--surface);
  display: block;
  text-decoration: none;
  color: var(--ink-2);
  transition: border-color 120ms ease, transform 120ms ease;
}
.news-item:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.news-item .meta { font-size: 11px; color: var(--ink-muted); }
.news-item .meta .dot {
  display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  margin-right: 5px; vertical-align: middle; background: var(--ink-faint);
}
.news-item .meta .dot.fresh { background: var(--negative); }
.news-item .meta .dot.recent { background: var(--accent-2); }

/* Anchor offset for sticky header */
.anchor-target { scroll-margin-top: 80px; }
`;

function renderThemeToggle(): string {
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
    return `<a href="${link.href}" class="${isActive ? 'is-active' : ''}">${link.label}</a>`;
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
          serif: ['Source Serif 4', 'Source Serif Pro', 'Georgia', 'serif'],
          mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        },
      },
    },
  };
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&display=swap" rel="stylesheet">
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/cdn.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<script>${CHART_THEME_HELPER}</script>
<style>${DESIGN_CSS}</style>
${opts.head ?? ''}
</head>
<body>
  <header class="app-header glass-strong">
    <div class="max-w-[1280px] mx-auto px-6 flex items-center gap-6">
      <a href="/" class="flex items-center gap-2.5 py-3" style="text-decoration:none;color:inherit;">
        <div class="brand-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="w-3.5 h-3.5">
            <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <span class="display text-[17px] ink" style="letter-spacing:-0.015em;">dividend-dash</span>
      </a>
      <nav class="flex items-center gap-0 ml-2">${navHtml}</nav>
      <div class="flex-1"></div>
      ${
        opts.asOf
          ? `<span class="text-[11px] muted hidden md:inline mr-1">as of <span class="num">${escapeHtml(opts.asOf)}</span></span>`
          : ''
      }
      <button type="button" id="dd-cmdk-trigger" class="search-trigger" aria-label="Open command palette">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 opacity-70"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span class="hidden md:inline flex-1 text-left">Search ticker, name, sector…</span>
        <kbd>⌘K</kbd>
      </button>
      ${renderThemeToggle()}
    </div>
  </header>

  <!-- Command palette -->
  <div id="dd-cmdk" class="hidden fixed inset-0 z-50 items-start justify-center pt-24 px-4" role="dialog" aria-modal="true" aria-label="Ticker search">
    <div class="dd-cmdk-backdrop absolute inset-0" data-cmdk-close></div>
    <div class="dd-cmdk-panel relative w-full max-w-xl overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3" style="border-bottom:1px solid var(--rule);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 muted"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input
          id="dd-cmdk-input"
          type="text"
          placeholder="Search by ticker or name (try SCHD, JNJ, dividend kings)…"
          autocomplete="off" autocapitalize="off" spellcheck="false"
          class="flex-1 bg-transparent text-base ink focus:outline-none"
          style="color:var(--ink);"
        >
        <kbd class="text-[10px] muted px-1.5 py-0.5 rounded font-mono" style="background:var(--surface-2);border:1px solid var(--rule);">esc</kbd>
      </div>
      <ul id="dd-cmdk-results" class="max-h-[60vh] overflow-y-auto"></ul>
      <div class="px-4 py-2 text-[11px] muted flex items-center justify-between" style="border-top:1px solid var(--rule);">
        <span><kbd class="font-mono">↑↓</kbd> navigate · <kbd class="font-mono">↵</kbd> open</span>
        <span class="text-[10px] faint">esc to close</span>
      </div>
    </div>
  </div>

  <main class="max-w-[1280px] mx-auto px-6 py-10">
    ${opts.body}
  </main>

  <footer class="app-footer">
    <div class="max-w-[1280px] mx-auto px-6">
      <p>dividend-dash · personal dividend research · not financial advice</p>
      <p class="mt-1">Data: Yahoo Finance &amp; SEC EDGAR · refresh via <code class="num">bun run seed-universe</code></p>
    </div>
  </footer>

  ${opts.footerScripts ?? ''}
  <script>${THEME_RUNTIME_SCRIPT}</script>
  <script>${CMDK_RUNTIME_SCRIPT}</script>
</body>
</html>`;
}

// === Shared format helpers ===

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

export function fmtCompactUsd(n: number | null, decimals = 2): string {
  if (n === null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(decimals)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(decimals)}K`;
  return `$${n.toFixed(decimals)}`;
}

export function fmtDate(d: string | null): string {
  if (!d) return '—';
  return d;
}

/** 0-100 score → letter grade (A+/A/B/C/D/F). */
export function scoreToGrade(score: number): { letter: string; cls: string } {
  if (score >= 90) return { letter: 'A+', cls: 'grade-A' };
  if (score >= 80) return { letter: 'A', cls: 'grade-A' };
  if (score >= 70) return { letter: 'B', cls: 'grade-B' };
  if (score >= 55) return { letter: 'C', cls: 'grade-C' };
  if (score >= 40) return { letter: 'D', cls: 'grade-D' };
  return { letter: 'F', cls: 'grade-F' };
}

/** Color a sustainability score 0–100. */
export function scoreColor(score: number): string {
  if (score >= 80) return 'positive';
  if (score >= 60) return 'accent-text';
  if (score >= 40) return 'accent-2-text';
  if (score >= 20) return 'accent-2-text';
  return 'negative';
}

/** Color a yield (higher = warmer). */
export function yieldColor(y: number | null): string {
  if (y === null) return 'muted';
  if (y >= 0.08) return 'negative';
  if (y >= 0.05) return 'accent-2-text';
  if (y >= 0.03) return 'positive';
  return 'ink-2';
}

/** Render a delta chip from a numeric change (in same units). */
export function renderDelta(
  value: number | null,
  opts: { suffix?: string; decimals?: number } = {},
): string {
  if (value === null || Number.isNaN(value)) {
    return `<span class="delta">—</span>`;
  }
  const suffix = opts.suffix ?? '';
  const decimals = opts.decimals ?? 2;
  const cls = value > 0 ? 'delta-pos' : value < 0 ? 'delta-neg' : '';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '◆';
  const abs = Math.abs(value).toFixed(decimals);
  return `<span class="delta ${cls}">${arrow} ${abs}${suffix}</span>`;
}
