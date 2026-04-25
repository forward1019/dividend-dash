/**
 * Centralized config loaded from environment variables. Validated lazily —
 * keys that are required only by certain commands (e.g. DISCORD_WEBHOOK_URL
 * for `digest`) are not validated at module load.
 *
 * `anthropicApiKey` is OPTIONAL and unused by `src/ai/brief.ts` — the brief
 * subprocess delegates to the local `claude` CLI which authenticates via
 * Claude Max OAuth at `~/.claude/.credentials.json`. The field is kept on
 * the Config type for callers that want to detect/forward an explicit API
 * key, but the brief code path no longer requires it.
 */

export interface Config {
  dbPath: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  secEdgarUserAgent: string;
  anthropicApiKey: string | undefined;
  discordWebhookUrl: string | undefined;
  polygonApiKey: string | undefined;
}

function readEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  return fallback;
}

export const config: Config = {
  dbPath: readEnv('DD_DB_PATH', './data/dividend-dash.db') ?? './data/dividend-dash.db',
  logLevel: (readEnv('DD_LOG_LEVEL', 'info') as Config['logLevel']) ?? 'info',
  // SEC's anti-bot system rejects generic/no-reply domains (e.g. users.noreply.github.com).
  // The default below is a placeholder — set SEC_EDGAR_USER_AGENT to "Your Name your@real-email.com"
  // in .env. Format required by SEC fair-access policy.
  secEdgarUserAgent:
    readEnv('SEC_EDGAR_USER_AGENT', 'DividendDash Research admin@example.com') ??
    'DividendDash Research admin@example.com',
  anthropicApiKey: readEnv('ANTHROPIC_API_KEY'),
  discordWebhookUrl: readEnv('DISCORD_WEBHOOK_URL'),
  polygonApiKey: readEnv('POLYGON_API_KEY'),
};

/** Throws if a key required for a specific command is missing. */
export function requireConfig<K extends keyof Config>(key: K): NonNullable<Config[K]> {
  const v = config[key];
  if (v === undefined || v === null || v === '') {
    throw new Error(
      `Missing required config: ${String(key)}. Set the corresponding env var (see .env.example).`,
    );
  }
  return v as NonNullable<Config[K]>;
}
