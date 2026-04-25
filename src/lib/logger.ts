import { config } from './config.ts';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function shouldLog(level: Level): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

function fmt(level: Level, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] ${level.toUpperCase()} ${msg}`;
  if (!meta) return prefix;
  return `${prefix} ${JSON.stringify(meta)}`;
}

export const log = {
  debug(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) console.log(fmt('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) console.log(fmt('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(fmt('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(fmt('error', msg, meta));
  },
};
