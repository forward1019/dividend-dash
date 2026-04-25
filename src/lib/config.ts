/**
 * Centralized config loaded from environment variables. Validated lazily —
 * keys that are required only by certain commands (e.g. ANTHROPIC_API_KEY for
 * `brief`, DISCORD_WEBHOOK_URL for `digest`) are not validated at module load.
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
  secEdgarUserAgent:
    readEnv('SEC_EDGAR_USER_AGENT', 'dividend-dash forward1019@users.noreply.github.com') ??
    'dividend-dash forward1019@users.noreply.github.com',
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
