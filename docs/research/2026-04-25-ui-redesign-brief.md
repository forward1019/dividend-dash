# UI/UX Redesign Research Brief: Dividend Tracking & Stock Detail
**Research Date:** 2026-04-25  
**Focus:** Leading dividend tracking and stock detail apps

---

## What Industry Leaders Do Well

Across Snowball Analytics, Sharesight, Stock Events, Seeking Alpha, Yahoo Finance, and other market leaders, several consistent patterns emerge that make these platforms feel professional, scannable, and trustworthy:

1. **Trust Through Social Proof**: Every leading app displays testimonials, star ratings (4.5+), award badges, and broker integration counts prominently on homepage. Users scan these before trying a product.

2. **Clear Information Hierarchy**: Hero sections use single, bold headlines ("Simple and powerful portfolio tracker", "Be the smarter investor") followed by 3-4 supporting benefit statements, not feature lists.

3. **Simplified Onboarding**: Free tier with immediate value (e.g., "Track up to 10 holdings for free") removes friction. Sign-up paths are 1-click.

4. **Sticky Navigation with Contextual Links**: Top nav remains fixed with dropdown menus for Features, Dividends, Tools, Community. Key CTAs (Sign in, Sign up) anchor to the right.

5. **Feature Cards with Icons**: Each feature presented as a card with icon, headline (3-5 words), one-sentence description, and supporting image. Avoids walls of text.

6. **Color-Coded Information**: Snowball uses accent colors for key metrics. Green for positive gains, red for losses. Pricing cards use subtle background colors to differentiate tiers (Free: white, Premium: soft blue).

7. **News/Updates Feed**: News items grouped by source with publication time badges ("Apr 22, 2026"). Each item shows headline, snippet, and source logo.

8. **Testimonial Carousel**: Rotating reviews with avatar, name, platform (Trustpilot/App Store), star rating, and one highlighted quote. Moves automatically or on click.

9. **Numeric "Proof" Blocks**: Large stat blocks (e.g., "500k+ investors", "700k+ stocks supported") instill confidence in user base and breadth of coverage.

10. **Award/Media Badges**: Logos of recognizing publications (Benzinga, Fintech Awards, Financial Review) cluster near bottom of page to reinforce credibility.

---

## Specific Design Patterns to Steal

### 1. **Sticky Search/Command Palette with Kbd Shortcut Hint**
**Origin:** Seeking Alpha, modern design tools (Figma, Linear)  
**Pattern:** Fixed search bar in header with subtle keyboard shortcut hint ("Cmd+K" on Mac, "Ctrl+K" on Windows) in light gray. Clicking reveals dropdown with recent searches, popular stocks, dividends, portfolios. Dark overlay on rest of page.  
**Apply to dividend-dash:** Place search in top nav. On focus, show: "Search stocks, dividends, ETFs" placeholder. Suggest recent tickers, high-yield dividend stocks, and portfolios. Use gray background for search input, white text on dark overlay.

### 2. **Color-Coded Yield Buckets (Safety Score)**
**Origin:** Simply Safe Dividends, Dividend.com  
**Pattern:** Dividend yields categorized by risk: Green (safe 3-5%), Yellow (moderate 5-8%), Orange (risky 8-12%), Red (unsustainable 12%+). Each stock card shows yield with matching color badge.  
**Apply to dividend-dash:** Create a "Dividend Safety" section showing portfolio yield distribution as colored percentage blocks (e.g., "28% Safe Green | 45% Moderate Yellow | 22% Risky Orange"). Clicking each block filters holdings by that category.

### 3. **ETF Holdings as Horizontal Bar List with Allocation %**
**Origin:** ETF.com, VettaFi  
**Pattern:** Top 10 holdings shown as horizontal bars (widths proportional to allocation). Each bar shows ticker (left), company name (center), percentage (right). Bars are color-coded by sector. Hovering shows more detail (shares, cost basis). Below bars: "99 other holdings" link to expandable full list.  
**Apply to dividend-dash:** For ETF detail pages, show "Top Holdings" section with this pattern. Add sector color legend on left. Allow filtering by sector. Show "Dividend contributions from top 10: $X/year".

### 4. **News Feed Grouped by Source with Freshness Badges**
**Origin:** Snowball Analytics, Seeking Alpha  
**Pattern:** News items grouped by source (TradingView, Yahoo Finance, Motley Fool). Each source cluster has source logo header. Within cluster: headline (bold, dark), snippet (gray, 2-3 lines), time badge ("2 hours ago", "Apr 22, 2026"), and small source icon. Alternate left/right alignment for visual rhythm.  
**Apply to dividend-dash:** News section groups items by source. Each item shows: headline (bold), snippet (gray), timestamp (light gray, right-aligned), and link. Use compact vertical spacing. Show only top 5 sources; expand link to "See all 15 sources".

### 5. **Fundamental Ratios in 4-Column Grid with Sparklines**
**Origin:** Yahoo Finance, Seeking Alpha, Robinhood  
**Pattern:** Key metrics (P/E, P/S, Dividend Yield, Beta) displayed in a 4-column grid. Each column is a card with metric name (small, gray), value (large, bold), and tiny inline sparkline (6-month trend). Cards have subtle background (light gray or light blue). Negative metrics show red text; positive show green. Clicking a card expands to 12-month chart.  
**Apply to dividend-dash:** Create "Quick Metrics" section below ticker hero. Show: P/E Ratio, Dividend Yield, Payout Ratio, Price/Book. Each card is 120px wide, stacked in responsive grid. Add "View Full Fundamentals" link below.

---

## Ticker Detail Page Blueprint

Recommended section order and data needed:

```
┌─────────────────────────────────────────┐
│ 1. HERO SECTION (ticker, price, change) │
│    ├─ Ticker (bold, large: "AAPL")      │
│    ├─ Company name & sector badge       │
│    ├─ Current price & % change (green/red)│
│    ├─ Open, High, Low, Close, Volume    │
│    └─ CTA buttons: "Add to Portfolio" / "Set Alert" │
├─────────────────────────────────────────┤
│ 2. PRICE CHART (interactive, 1D/1W/1M/3M/1Y/5Y) │
│    └─ Candlestick chart with volume bars below │
├─────────────────────────────────────────┤
│ 3. DIVIDEND SPOTLIGHT                   │
│    ├─ Next dividend date                │
│    ├─ Annual dividend (yield %)         │
│    ├─ Payout ratio                      │
│    ├─ 5-year dividend growth chart      │
│    └─ "Dividend Safety" score (color badge) │
├─────────────────────────────────────────┤
│ 4. QUICK METRICS (4-column grid)        │
│    ├─ P/E Ratio / Sparkline             │
│    ├─ Price/Sales / Sparkline           │
│    ├─ Price/Book / Sparkline            │
│    └─ Market Cap                        │
├─────────────────────────────────────────┤
│ 5. FUNDAMENTALS PANEL                   │
│    ├─ 52-week High/Low                  │
│    ├─ Average volume                    │
│    ├─ Beta (vs S&P 500)                 │
│    ├─ EPS (TTM)                         │
│    ├─ Free Cash Flow (TTM)              │
│    └─ Debt/Equity ratio                 │
├─────────────────────────────────────────┤
│ 6. HOLDING DETAILS (if in portfolio)    │
│    ├─ Shares owned                      │
│    ├─ Cost basis / purchase date        │
│    ├─ Current value & gain/loss $       │
│    ├─ Projected dividend income (this year) │
│    └─ "Edit Holding" button             │
├─────────────────────────────────────────┤
│ 7. NEWS FEED                            │
│    └─ Latest 5 news items by source     │
├─────────────────────────────────────────┤
│ 8. ANALYST RATINGS (if available)       │
│    ├─ Consensus rating (Buy/Hold/Sell)  │
│    ├─ Price target                      │
│    └─ # analysts rating                 │
└─────────────────────────────────────────┘
```

**Data requirements:**  
Real-time: price, volume, change  
Daily: open, high, low, close  
Quarterly: earnings, revenue  
Annual: P/E, dividend, yield, payout ratio, debt/equity  
Historical: 5-year dividend history, price history for charts

---

## ETF Detail Page Blueprint

Top holdings and composition view:

```
┌─────────────────────────────────────────┐
│ 1. HERO (ticker, name, NAV, % change)   │
│    ├─ ETF ticker & name (e.g., "VYM - Vanguard High Dividend ETF") │
│    ├─ Current NAV & % change            │
│    ├─ Assets under management (AUM)     │
│    ├─ Expense ratio (ER)                │
│    └─ CTAs: "Buy", "Add to Portfolio", "Set Alert" │
├─────────────────────────────────────────┤
│ 2. HOLDINGS COMPOSITION (2-column)      │
│    ├─ Left: Top 10 Holdings (bar chart) │
│    │   └─ Horizontal bars with ticker, company, % │
│    │   └─ Sector color coding           │
│    │   └─ "View all 300+ holdings" link │
│    └─ Right: Sector Breakdown (pie chart) │
│        └─ Top 5 sectors as donut segments │
│        └─ "See sector drill-down" link  │
├─────────────────────────────────────────┤
│ 3. KEY METRICS (4-column grid)          │
│    ├─ Dividend Yield (portfolio level)  │
│    ├─ Expense Ratio                     │
│    ├─ 52-week price range               │
│    └─ P/E (weighted by holdings)        │
├─────────────────────────────────────────┤
│ 4. DIVIDEND HISTORY                     │
│    └─ Table: ex-date, pay-date, amount per share, yield │
├─────────────────────────────────────────┤
│ 5. PERFORMANCE CHART                    │
│    └─ 1Y, 3Y, 5Y vs benchmark (e.g., S&P 500) │
├─────────────────────────────────────────┤
│ 6. FUND DETAILS                         │
│    ├─ Net Assets                        │
│    ├─ Inception Date                    │
│    ├─ Benchmark Index                   │
│    └─ Holdings turnover rate            │
└─────────────────────────────────────────┘
```

---

## News Feed Pattern

**Item Shape:**  
Compact card, left-aligned, with:
- Source icon (16px, left margin)
- Headline (bold, dark, 14-16px)
- Snippet (gray, 2-3 lines, 13px)
- Timestamp (light gray, "2h ago" or "Apr 22", right-aligned, 12px)
- Hover effect: background tint, show "Read" link

**Grouping:**  
Group by source (TradingView, Yahoo Finance, MarketWatch). Each group has source name as sticky subheader. Maximum 5 items per source shown; "Show 10 more from [Source]" link below.

**Freshness Markers:**  
- Red dot if < 1 hour old
- Orange dot if < 6 hours old  
- Gray text timestamp for older items

**Scrolling:**  
Auto-load next batch on scroll to bottom. Show loading spinner.

---

## Stock Fundamentals Panel Layout

**Recommended metrics and layout:**

Best displayed as a 2x5 table (10 metrics) or 2-column grid with cards:

| Metric | Priority | Display Format |
|--------|----------|-----------------|
| P/E Ratio | HIGH | Large number with 5Y sparkline |
| P/S Ratio | HIGH | Number with industry average comparison |
| P/B Ratio | HIGH | Number, typically < 3 is good |
| Market Cap | HIGH | "$ Billions" with category (Large/Mid/Small) badge |
| Volume | HIGH | Average daily volume + % change |
| Beta | MEDIUM | Number (1.0 = market; >1 = more volatile) |
| 52W High/Low | HIGH | Range display: "$X - $Y" |
| EPS (TTM) | MEDIUM | Earnings per share, trailing twelve months |
| Dividend Yield | HIGH | Large %, color-coded (green/yellow/red) |
| Payout Ratio | HIGH | % of earnings paid as dividends |
| Free Cash Flow | MEDIUM | "$X Millions" with trailing 4Q |
| Debt/Equity | MEDIUM | Ratio, < 1.0 generally healthy |
| ROE | MEDIUM | Return on equity %, annual |
| 52W Change | MEDIUM | % up/down |
| Book Value | MEDIUM | Per share value |
| Earnings Growth | MEDIUM | YoY % growth, color-coded |

**Layout recommendation:**  
Use a **grid of 4-6 cards** per row (responsive: 2 cards on mobile, 4 on tablet, 6 on desktop).
Each card:
- Metric name (gray, 11px, all-caps)
- Value (dark, bold, 18px)
- Optional: sparkline or comparison (e.g., "vs. industry avg")
- Optional: status badge (green ✓, yellow ⚠, red ✗)

Click any card to open a detailed view with historical trends.

---

## Color & Typography Recommendations

### Color Palette

**Primary Colors:**
- **Action Blue:** #0066CC (for CTAs, links, active states)
- **Success Green:** #059669 (positive gains, buy signals, healthy metrics)
- **Warning Orange:** #F59E0B (yield warnings, moderate risk, caution)
- **Alert Red:** #DC2626 (losses, sell signals, unsustainable yields)
- **Neutral Gray:** #6B7280 (secondary text, borders, disabled states)

**Background Colors:**
- **White:** #FFFFFF (main background)
- **Light Gray:** #F9FAFB (card backgrounds, input fields)
- **Dark Background (for dark mode):** #1F2937 (optional)

**Dividend Safety Color Scheme:**
- **Safe (3-5% yield):** Green #10B981
- **Moderate (5-8%):** Amber #FBBF24
- **Elevated (8-12%):** Orange #F97316
- **Unsustainable (12%+):** Red #EF4444

### Typography

**Font Stack:**
```css
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
```

**Monospace (for numbers, tickers, prices):**
```css
.ticker, .price, .metric {
  font-family: "SF Mono", Monaco, "Courier New", monospace;
  font-weight: 500;
  letter-spacing: 0.02em;
}
```

### Scale & Weights

| Usage | Size | Weight | Line-Height |
|-------|------|--------|-------------|
| H1 (Page title, ticker) | 32-40px | 700 | 1.2 |
| H2 (Section titles) | 24-28px | 600 | 1.3 |
| H3 (Card titles) | 16-18px | 600 | 1.4 |
| Body (default) | 14-16px | 400 | 1.6 |
| Small (captions, labels) | 12-13px | 500 | 1.5 |
| Labels (form, metric names) | 11px | 600 (uppercase) | 1.4 |

**Key Principle:** Use monospace, weight 600-700, for all prices, tickers, and financial metrics. This makes them scan-friendly and distinct from prose.

### Spacing

- **Padding:** 8px, 12px, 16px, 24px, 32px (8px base unit)
- **Gap (between items):** 12px (cards), 24px (sections)
- **Line spacing:** 1.5 default, 1.6 for body text
- **Section spacing:** 40px-64px vertical gap between major sections

### Anti-Patterns to Avoid

1. **Cluttered information:** Don't show 30+ metrics on one page. Prioritize 8-12 key ones; put rest behind "Expand" or separate view.
2. **Ad-heavy layout:** Avoid interstitial ads or ad banners disrupting content flow. If monetized, place ads in fixed sidebar (desktop only) or at bottom.
3. **Hard-to-scan lists:** Use cards, grids, or tables—never plain bullet-point lists for financial data.
4. **Inconsistent color coding:** Always use same green/red/yellow for positive/negative/neutral across all pages.
5. **Auto-playing videos/animations:** News items shouldn't auto-play. Charts shouldn't animate on load—let user control.
6. **Tiny text for numbers:** Never use < 14px for prices, yields, or key metrics. These are scannable elements.
7. **Overloaded hero sections:** Hero should be max 3 lines of text + 1-2 metrics + 1 CTA button. Avoid competing headlines.
8. **Broken broker logos:** Snowball & Sharesight showcase 50+ broker logos—ensure they load, have consistent sizing (30-40px height).
9. **No affordance for expansion:** If a row shows "Top 10 holdings", make it obvious there are more ("+450 others" link).
10. **Complex dividend data:** Avoid mixing yield %, payout ratio, growth %, and ex-date in one view. Separate into "Quick View" (yield + next date) and "Detailed History" (table view).

---

## Implementation Notes

### Page Responsiveness
- **Mobile (< 640px):** Single column, full-width cards, collapsible sections
- **Tablet (640-1024px):** 2-column layout, chart above fundamentals
- **Desktop (> 1024px):** 3-4 column layout, sidebar for watchlist or filters

### Performance Considerations
- Lazy-load news feed and historical charts
- Cache price data for < 1 minute
- Prefer static bar charts over animated candlesticks for ETF holdings

### Accessibility
- Use semantic HTML (headings, nav, main, footer)
- Color should not be sole indicator (e.g., red + ✗ icon for loss)
- Ensure 4.5:1 contrast ratio for all text

---

## Summary of Top 5 Ideas to Steal

1. **Dividend Safety Color Badges** (Green/Yellow/Orange/Red yield buckets) — instantly communicates risk without reading text
2. **Horizontal Bar Chart for ETF Holdings** (Top 10 with sector coloring + allocation %) — more scannable than tables or lists
3. **Grouped News Feed by Source** with freshness indicators (red dot for < 1hr, gray timestamp) — shows relevance at a glance
4. **4-Column Metric Grid with Sparklines** for quick fundamentals (P/E, Yield, P/B, Volume) — professional, dense, scannable
5. **Sticky Command Palette Search** (Cmd+K / Ctrl+K) with recent stocks + dividends autocomplete — speeds navigation for power users

---

**End of Research Brief**
