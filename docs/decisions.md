# Decisions log

Reversible judgment calls made during autonomous execution. Each entry: date, decision, rationale, how to revisit.

## 2026-04-25 — Project scaffold

### Use Biome instead of ESLint + Prettier

**Decision:** Single-binary Biome for lint + format.

**Rationale:** Faster than ESLint, no plugin sprawl, Bun-native fits the rest of the stack. Owner's other repos (`agent-scout`, `wheel-bot`) use it.

**Revisit if:** Need a specific lint rule that Biome doesn't ship.

### Use `bun:sqlite` not `better-sqlite3`

**Decision:** Use Bun's built-in SQLite.

**Rationale:** No native compile step, faster startup, ships with Bun. The owner's other personal projects use it.

**Revisit if:** Need a specific better-sqlite3 feature like custom functions in JS.

### Single SQLite file, no migrations framework

**Decision:** `src/db/schema.sql` is the source of truth. `migrate.ts` runs `CREATE TABLE IF NOT EXISTS` statements.

**Rationale:** Single user, single machine. A migrations framework is over-engineered until schema changes happen with users in production. Add `drizzle-kit` or similar later if needed.

**Revisit when:** Second user or first destructive schema change (column rename, type change).

### Sustainability scorecard weights: 35/35/20/10

**Decision:**
- Payout ratio (lower better): 35%
- FCF cover (higher better): 35%
- Growth streak (longer better): 20%
- Debt/equity (lower better): 10%

**Rationale:** Payout ratio and FCF cover are the two most predictive of dividend cuts in the academic literature on dividend policy (Lintner 1956, Brav et al 2005). Growth streak is a behavioral signal — long-streak payers cut later. Debt/equity is a tail-risk factor.

**Revisit:** After backtesting against known historical cuts (AT&T 2022, KMI 2015, GE 2018) — adjust if warnings would have missed.

### Monte Carlo distribution: log-normal on 10-year CAGR

**Decision:** Fit a log-normal distribution to the trailing 10-year per-share dividend CAGR per holding. Sample 10,000 paths.

**Rationale:** Dividend growth is bounded below by zero (cuts go to ~0, not negative) and right-skewed historically. Log-normal captures both. 10k paths is enough for stable P10/P50/P90.

**Revisit if:** Backtest shows systematic over- or under-projection. Alternatives: empirical bootstrap, Student-t with thicker tails.

### LLM: claude-opus-4-7 for the brief

**Decision:** Use claude-opus-4-7 for AI dividend briefs.

**Rationale:** Highest quality is worth it because the brief is read by a human and informs a buy/sell decision. Cost is ~$0.05–0.15 per brief × 30 holdings × 1 brief/week = ~$10/month max.

**Revisit if:** Cost climbs past $30/mo or claude-sonnet-4 produces equivalent quality.

### Digest delivery: Discord webhook, not bot

**Decision:** Use a Discord incoming webhook to post the weekly digest, not the Hermes bot identity.

**Rationale:** Simpler — no token rotation, no per-channel permission management. Owner gets a clean "dividend-dash" webhook identity for the digest.

**Revisit if:** Need rich interactivity (buttons, slash commands) — then promote to a bot.

### No web UI

**Decision:** No frontend. CLI + cron + Discord digest.

**Rationale:** Owner already lives in Discord. A web UI is undifferentiated effort that would not get used. The digest is the UI.

**Revisit if:** Owner explicitly asks for a web view of historical data.
