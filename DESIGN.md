# dividend-dash design system (v0.5)

> Personal dividend research dashboard. The visual reference is editorial
> finance media (Seeking Alpha, Morningstar, Bloomberg.com) — dense, sober,
> data-rich. Not SaaS marketing, not generic dashboard template.

## Tone

- **Editorial, not marketing.** No hero copy. No "unlock the power of...".
  Section headers state what's in the section.
- **Confident with data.** Big numbers, small labels (uppercase tracking),
  tabular numerics, monospaced cents.
- **One screen, one focus.** Every page has a clear "thing you came here for"
  near the top. Drill-downs live below.
- **Sober color.** Color is reserved for meaning (delta, score, sector). Not
  for decoration.

## Type system

| Use | Family | Notes |
|---|---|---|
| Display headlines (hero ticker, page H1) | **Source Serif 4** 600 | Editorial accent. Used sparingly. |
| Body, UI, controls | **Inter** 400/500/600 | Default text. |
| Numerics, tickers, kbd | **JetBrains Mono** 400/500 | Tabular nums on. |
| Labels (UPPERCASE) | Inter 600 + 0.06em tracking + 11px | Section labels, KPI titles. |

Heading scale (rem): 2.25 / 1.75 / 1.375 / 1.125 / 1 — Perfect Fourth.

## Color tokens

### Dark (default)

```
--ink-950: #0a0d14    page background
--ink-900: #0f131c    elevated surface
--ink-800: #161b27    card surface
--ink-700: #1d2433    border
--ink-600: #2a3344    border-strong
--ink-300: #94a3b8    body muted
--ink-200: #cbd5e1    body
--ink-100: #e2e8f0    body strong
--ink-50:  #f1f5f9    headline
--accent:    #34d399  emerald (brand / positive)
--accent-2:  #f59e0b  amber (highlight / warning yellow)
--positive:  #4ade80  delta up
--negative:  #f87171  delta down
--neutral:   #94a3b8  delta flat
```

### Light

```
--paper:     #fafaf6  page (warm off-white, not pure)
--surface:   #ffffff  card
--ink:       #0a0d14  text strong
--ink-2:     #1f2937  text body
--ink-3:     #475569  text muted
--rule:      #e7e5e0  border subtle
--rule-2:    #d6d3cd  border
--accent:    #059669  emerald (darker for AA)
--accent-2:  #b45309  amber-700
--positive:  #047857
--negative:  #be123c
```

## Components

### KPI tile (`.kpi`)

```
┌─────────────────────────┐
│ FORWARD YIELD           │   <- 11px UPPER label, --ink-300
│ 4.32%                   │   <- 1.875rem mono number
│ ▲ 0.18 vs 30d           │   <- delta chip
└─────────────────────────┘
```

Use for: hero KPIs, fundamentals strip, leaderboards. Always 4-up or 5-up
in a grid. Numbers are mono and tabular.

### Quote hero (`.hero-quote`)

Stock-page hero. Symbol big-display (Source Serif), name secondary,
big price right-aligned, change/change% directly under price, mini
sparkline strip across the full width below.

### Delta chip (`.delta`)

Pill with arrow + value. Green for positive, red for negative, slate for
flat. `▲ 0.18` / `▼ 1.4%`. Uses tabular nums.

### Score badge (`.score-badge`)

Letter grade A+/A/B/C/D/F in a colored pill (emerald → rose). Rendered
from numeric sustainability score. Replaces the current 2-digit ring.

### Data table (`.data-table`)

Dense table: zebra rows, sticky header, right-aligned numbers, mono nums,
hover row highlight, no vertical borders. Used for holdings, recent
payments, calendar entries.

### Section header (`.section-h`)

```
SECTION LABEL                              [optional action]
```

Eyebrow uppercase, 0.06em tracking, --ink-300. Followed by an h2 in
Source Serif if the section needs a real headline, otherwise just the
label by itself.

### Chart palette

Always read from `window.__chartTheme()`. Colors are baked there so a
single function controls dark/light look across every chart.

Multi-series default order: emerald → amber → cyan → violet → rose →
lime → blue → pink. Sparkline = emerald solid, no fill in dark, soft fill
in light.

## Layout principles

- **Max width 1200px** for content. Hero strips and dashboard grids may
  span the full 1280px. No full-bleed body text.
- **Vertical rhythm**: `space-y-6` between major sections, `space-y-3`
  inside a card.
- **Padding scale**: 4 / 8 / 12 / 16 / 20 / 24 / 32 px. No off-scale
  values.
- **Card radius**: `rounded-xl` (12px) for cards, `rounded-lg` (8px)
  for chips/buttons, `rounded-2xl` (16px) only for the command palette.
- **Borders**: 1px subtle. Glass effect uses 1px border + soft shadow,
  not pure background tint.

## Information hierarchy

Every page top-to-bottom:

1. **Hero**: the one thing the page is about (KPIs / quote / topic).
2. **At-a-glance**: 3-5 secondary metrics that contextualize the hero.
3. **Drill-downs**: charts, tables, sub-pages. Scrollable below the fold.
4. **Detail**: long-form context (descriptions, news, history).

A user who reads only screen 1 should leave with the headline. A user who
scrolls should find depth, not noise.

## What this design system rejects

- **Generic SaaS gradients** (purple/violet hero washes).
- **3-column "feature" grids** with icons-in-circles.
- **Centered hero copy**. Editorial product pages are left-aligned.
- **Decorative blobs / wavy SVGs**.
- **Same border-radius on everything**.
- **Color-only encoding** (always pair with label or icon).
- **Real-time price ticking**. EOD data is enough; flashy is not the point.

## File map

- `src/web/views/layout.ts` — owns the design tokens, fonts, light/dark
  CSS, header, command palette, footer.
- `src/web/views/dashboard.ts` — implements the dashboard hero + universe
  panels + leaderboards + filter grid.
- `src/web/views/ticker.ts` — implements the quote-hero ticker page.
- `src/web/views/compare.ts` — implements the comparator with scatter.
- `src/web/views/calendar.ts` — implements the income calendar.

When adding a new component or page, **read this file first**. If you
need a new component, add it here so the system stays coherent.
