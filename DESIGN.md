# dividend-dash design system (v0.6)

> Personal dividend research dashboard. Visual reference: editorial finance
> media (Bloomberg.com, Morningstar, The Information, FT) — sober, sparse,
> data-rich, **calm**. Not SaaS marketing. Not "dashboard with everything".

## v0.6 changes (the cleanup)

- **One scroll, four sections.** Dashboard collapsed from 5 dense sections
  to 4 quieter ones: Hero → Income outlook → Movers → Browse.
- **Dropped from home:** sector donut, yield histogram, frequency mix bars.
  Universe shape lives as a single inline stat strip, not three charts.
- **Browse defaults to a dense table** instead of 60 cards. Optional grid
  toggle for the days you want pictures. The 4-col card grid was 80% of
  the page; the table is one screen.
- **No background gradients.** Plain page color. Less "AI dashboard glow".
- **Single accent.** Emerald, period. Amber retired from decoration —
  reserved strictly for warnings.
- **Quieter cards.** Borders 1px at 8% (was 10–18%); no shadow on resting
  cards. Hover is what changes.
- **Generous rhythm.** Section spacing `space-y-10` (was `space-y-7`),
  subsection `space-y-4`. Lines breathe.
- **Charts are flatter.** No vertical grid lines. Y-grid at 6% only. Thinner
  axes. Restrained palette (mostly emerald + neutral).

## Tone

- **Editorial, not marketing.** No hero copy, no gradient sky, no feature
  triplet. A page header is a label + a number.
- **Confident with data.** Big numbers, small uppercase labels, tabular
  numerics, monospaced cents.
- **One screen, one focus.** Every page has one "thing you came here for"
  near the top. Drill-downs live below — but they're calmer now.
- **Sober color.** Color is reserved for meaning (delta, score). Not
  decoration. Sectors no longer get rainbow palettes on the home page.

## Type system

| Use | Family | Notes |
|---|---|---|
| Display headlines (page H1, hero ticker) | **Source Serif 4** 600 | Editorial accent. Used sparingly. |
| Body, UI, controls | **Inter** 400 / 500 / 600 | Default text. |
| Numerics, tickers, kbd | **JetBrains Mono** 400 / 500 | Tabular nums on. |
| Labels (UPPERCASE eyebrow) | Inter 600 + 0.08em tracking + 10.5px | Section labels, KPI titles. |

Heading scale (rem): 2.25 / 1.75 / 1.375 / 1.125 / 1 — Perfect Fourth.

Body line-height: 1.55. Labels: 1.4. Numbers: 1.05.

## Color tokens

### Dark (default)

```
--bg:        #0a0d14    page (no gradient)
--bg-elev:   #0e1218    elevated bar / palette
--surface:   #11151e    card (lower contrast vs bg, was #161b27)
--surface-2: #161b22    chip / input / hover
--rule:      rgba(148,163,184,0.08)   borders subtle (was 0.10)
--rule-2:    rgba(148,163,184,0.16)   borders strong
--ink:       #f1f5f9    headline
--ink-2:     #e2e8f0    body strong
--ink-3:     #cbd5e1    body
--ink-muted: #94a3b8    body muted
--ink-faint: #64748b    captions
--accent:    #34d399    emerald (the one accent)
--positive:  #4ade80
--negative:  #f87171
--neutral:   #94a3b8
```

### Light

```
--bg:        #fafaf6    warm off-white
--bg-elev:   #ffffff
--surface:   #ffffff
--surface-2: #f3f2ec
--rule:      rgba(15,23,36,0.06)
--rule-2:    rgba(15,23,36,0.12)
--ink:       #0a0d14
--ink-2:     #1f2937
--ink-3:     #334155
--ink-muted: #475569
--accent:    #059669
--positive:  #047857
--negative:  #be123c
```

Amber (`#fbbf24` dark / `#b45309` light) is retained but used **only** for
warning chips and `accent-2-text` on stale-data captions. Not for KPI fills,
not for bar charts.

## Components

### KPI tile (`.kpi`)

```
┌─────────────────────────┐
│ FORWARD YIELD           │   <- 10.5px UPPER label, --ink-muted
│ 4.32%                   │   <- 1.875rem mono number
│ 0.18 vs 30d             │   <- delta in normal weight, no chip on home
└─────────────────────────┘
```

Use sparingly: hero strip on a page (max 4 in a row). On the home page,
the KPI strip lives inline with the headline ("60 dividend payers · ...").

### Section header (`.section-h`)

```
SECTION LABEL          1 LINE OF SUB-CONTEXT          [optional action]
```

Eyebrow uppercase, 0.08em tracking. The eyebrow IS the section name —
no h2 underneath unless absolutely needed. Bottom border is hairline,
margin-bottom 1rem.

### Data table (`.data-table`)

The default browse surface. Dense but breathing rows: 12px vertical
padding, sticky header, right-aligned numerics, mono numerics, hover row
highlight at 4% (was 5–6%), no vertical borders. Used for holdings,
recent payments, calendar entries, and now the **universe browse**.

### Ticker row (`.ticker-row`) — NEW v0.6

Inline list version of the ticker card. Used in the dashboard browse
table and on /compare. Shows: ticker, name, kind pill, fwd yield,
5y CAGR, streak, safety grade, sparkline (optional, only on hover or
in grid mode). One line per ticker.

### Ticker card (`.ticker-card`) — kept

Still around for the optional grid view in browse, and for any place a
preview tile makes sense (e.g. compare picker preview). Just doesn't
dominate the home page anymore.

### Delta chip (`.delta`)

Pill with arrow + value. Green / red / neutral. Used in tables and
hero only, never to decorate a KPI on the home page.

### Score badge (`.grade`)

A+ … F in a colored pill. 5 buckets, emerald → rose. Same visual
weight as in v0.5.

### Pills

`.pill-emerald` for ETF, `.pill-violet` for stock, `.pill-slate` for
neutral metadata. **Cyan and amber pills retired** from the home/list —
they were too loud. Allowed on per-ticker pages.

### Chart palette

Always read from `window.__chartTheme()`. v0.6 baseline:

- **Single-series line / bar:** emerald only (`emerald` + `emeraldFill`).
- **Multi-series (compare):** emerald → cyan → violet → amber → rose →
  slate. Same as before.
- **Sector / categorical:** retains 12-color palette but only used on
  per-ticker holdings and /compare scatter — NOT on the dashboard.
- **Grid:** y-axis only, 6% line. No vertical grid. No background fill
  on bar charts.
- **Tick labels:** 10px, ink-muted.

## Layout principles

- **Max width 1200px** for content. Hero strips and dashboard tables can
  span the full 1280px. No full-bleed body text.
- **Vertical rhythm:** `space-y-10` between top-level sections,
  `space-y-4` inside a section, `space-y-2` inside a card.
- **Padding scale:** 4 / 8 / 12 / 16 / 20 / 24 / 32 px. No off-scale.
- **Card radius:** `rounded-xl` (12px) for cards, `rounded-lg` (8px)
  for chips/buttons, `rounded-2xl` (16px) only for the command palette.
- **Borders:** 1px, hairline. Resting state has NO box-shadow. Hover
  may add a subtle shadow + accent border.
- **Background:** flat `--bg`. No radial blooms. The page has fewer
  competing elements; the bg gets out of the way.

## Information hierarchy (per page)

Every page top-to-bottom:

1. **Headline + 1–4 KPIs.** What is this page about? One number you'd
   take to lunch.
2. **Primary visual.** One chart or one table that delivers the page's
   core insight.
3. **Drill-downs.** Sub-sections, calmer. No more than 3.
4. **Detail / context.** Long-form prose, descriptions, footnotes.

A user who reads only screen 1 should leave with the headline. A user
who scrolls should find depth, **not noise**.

## What this design system rejects

- **Generic SaaS gradients** (purple/violet hero washes, glow blooms).
- **3-column "feature" grids** with icons-in-circles.
- **Centered hero copy.** Editorial product pages are left-aligned.
- **Decorative blobs / wavy SVGs.**
- **Same border-radius on everything.**
- **Color-only encoding** (always pair color with label or icon).
- **Real-time price ticking.** EOD data is enough; flashy is not the point.
- **NEW v0.6:** **Three-panel "at a glance" rows of mini charts.** They
  add chart noise without adding insight; the tickers themselves carry
  that detail.
- **NEW v0.6:** **60-card grids on the home page.** Tables scan faster.

## File map

- `src/web/views/layout.ts` — owns the design tokens, fonts, light/dark
  CSS, header, command palette, footer.
- `src/web/views/dashboard.ts` — implements the 4-section dashboard.
- `src/web/views/ticker.ts` — implements the quote-hero ticker page.
- `src/web/views/compare.ts` — implements the comparator with scatter.
- `src/web/views/calendar.ts` — implements the income calendar.

When adding a new component or page, **read this file first**. If you
need a new component, add it to `layout.ts` so the system stays coherent.
