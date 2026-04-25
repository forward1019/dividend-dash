/**
 * AI dividend brief: Claude reads the latest 10-K (and optionally an
 * earnings call transcript) and produces a structured assessment of the
 * dividend story.
 *
 * Auth: this module shells out to the local `claude` CLI (Claude Code) so the
 * request authenticates via the user's Claude Max OAuth credentials at
 * `~/.claude/.credentials.json` — same pattern as the Hermes Python shim.
 * If the environment has `ANTHROPIC_API_KEY` set, the `claude` binary picks
 * that up automatically and uses the API account instead. No code path
 * change required.
 *
 * Why not call api.anthropic.com directly with the OAuth token? Anthropic
 * 400s raw-OAuth REST calls as "external OAuth" with a tiny Opus/Sonnet
 * allowance. Routing through the `claude` subprocess gives the request the
 * proper Claude Code fingerprint and the full Max quota.
 *
 * Structured output is enforced via `--json-schema`, which validates
 * server-side and returns parsed JSON in the `structured_output` field of
 * the `--output-format=json` envelope — no manual JSON parsing of model
 * text required.
 */

import { z } from 'zod';

import { extractDividendSection, fetchLatest10K, plainTextFromHtml } from './fetch-10k.ts';

export const BriefSchema = z.object({
  ticker: z.string(),
  filingDate: z.string(),
  oneLineThesis: z.string().describe('Single sentence summary of dividend story.'),
  dividendHealth: z.enum(['robust', 'stable', 'watch', 'fragile']),
  payoutPolicySummary: z.string(),
  managementGuidance: z.string(),
  recentChanges: z
    .array(z.string())
    .describe('Notable changes in capital return policy, payout, or coverage.'),
  positiveSignals: z.array(z.string()),
  riskFlags: z.array(z.string()),
  cutProbability12mo: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['low', 'medium', 'high']).describe('LLM self-rated confidence.'),
});
export type DividendBrief = z.infer<typeof BriefSchema>;

const SYSTEM_PROMPT = `You are a dividend equity analyst. You read 10-K filings and produce dispassionate, evidence-based assessments of a company's dividend sustainability and policy.

Rules:
- Quote specific figures from the 10-K when relevant (payout ratio, FCF, debt, repurchase activity).
- Flag risks aggressively. Missed risks hurt more than false alarms.
- Do not opine on stock price direction. Stick to dividend health.
- If the 10-K is for a fund/ETF, note that the assessment is necessarily limited (no operating-company fundamentals).
- Be concise. Single-sentence summaries should be one sentence.
- Output via the structured JSON schema only.`;

/**
 * JSON Schema mirror of BriefSchema, in the format Claude Code's
 * `--json-schema` flag expects. Kept hand-written rather than generated
 * (zod 3.24 has no native toJSONSchema; avoiding the extra dep).
 * If you change BriefSchema, update this too — there's a unit-style
 * sanity check in tests/ai-brief.test.ts.
 */
const BRIEF_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'ticker',
    'filingDate',
    'oneLineThesis',
    'dividendHealth',
    'payoutPolicySummary',
    'managementGuidance',
    'recentChanges',
    'positiveSignals',
    'riskFlags',
    'cutProbability12mo',
    'confidence',
  ],
  properties: {
    ticker: { type: 'string' },
    filingDate: { type: 'string' },
    oneLineThesis: { type: 'string' },
    dividendHealth: { type: 'string', enum: ['robust', 'stable', 'watch', 'fragile'] },
    payoutPolicySummary: { type: 'string' },
    managementGuidance: { type: 'string' },
    recentChanges: { type: 'array', items: { type: 'string' } },
    positiveSignals: { type: 'array', items: { type: 'string' } },
    riskFlags: { type: 'array', items: { type: 'string' } },
    cutProbability12mo: { type: 'string', enum: ['low', 'medium', 'high'] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
} as const;

export interface BriefOptions {
  /** Override the model. Defaults to claude-opus-4-7 per docs/decisions.md. */
  model?: string;
  /** Optional earnings call transcript text (Phase 5+ enhancement). */
  earningsCallText?: string;
  /** Cap on 10-K text passed to the model. Default 60k characters. */
  maxTenKChars?: number;
  /** Override the claude binary path. Default: $CLAUDE_BIN or 'claude' from PATH. */
  claudeBin?: string;
}

interface ClaudeCliEnvelope {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: unknown;
}

/**
 * Spawn `claude -p` and capture the JSON envelope. The user prompt goes
 * over stdin so we don't run into ARG_MAX with 60k chars of 10-K text.
 */
async function callClaudeCli(opts: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: object;
  model: string;
  claudeBin: string;
}): Promise<unknown> {
  const args = [
    '-p',
    '--output-format=json',
    '--system-prompt',
    opts.systemPrompt,
    '--json-schema',
    JSON.stringify(opts.jsonSchema),
    '--model',
    opts.model,
    // Single LLM call — no internal tool loops. The agent loop adds turns
    // and cost without changing the structured-output result.
    '--tools',
    '',
    // Don't pollute the resume picker with one-off briefs.
    '--no-session-persistence',
    // Don't load user/project/local settings.json (they could inject
    // unrelated MCP servers, hooks, or output style overrides).
    '--setting-sources=',
  ];

  // Build the subprocess env. By default we STRIP ANTHROPIC_API_KEY (and
  // ANTHROPIC_AUTH_TOKEN) so the claude binary falls back to its Claude
  // Max OAuth credentials at ~/.claude/.credentials.json — that is the
  // whole point of using the CLI subprocess pattern (mirrors the Hermes
  // Python shim). Set DD_USE_ANTHROPIC_API_KEY=1 to opt into API-key
  // billing instead, in which case the env passes through unchanged.
  const useApiKey =
    process.env.DD_USE_ANTHROPIC_API_KEY === '1' || process.env.DD_USE_ANTHROPIC_API_KEY === 'true';
  const STRIPPED_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']);
  const subprocessEnv = useApiKey
    ? { ...process.env }
    : Object.fromEntries(Object.entries(process.env).filter(([k]) => !STRIPPED_KEYS.has(k)));
  // cwd=/tmp avoids CLAUDE.md auto-discovery walking up from this repo.
  // (A non-empty `--system-prompt` already replaces the default Claude
  // Code system prompt, but cwd=/tmp is belt-and-suspenders.)
  const proc = Bun.spawn([opts.claudeBin, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: '/tmp',
    env: subprocessEnv,
  });

  proc.stdin.write(opts.userPrompt);
  await proc.stdin.end();

  const [stdoutText, stderrText, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Try to parse the envelope first — claude reports rich errors via
  // stdout JSON (is_error=true with api_error_status), and may exit
  // non-zero even on parseable error envelopes. Surface those clearly.
  let envelope: ClaudeCliEnvelope | undefined;
  if (stdoutText.trim().length > 0) {
    try {
      envelope = JSON.parse(stdoutText) as ClaudeCliEnvelope;
    } catch {
      // fall through to raw exit-code reporting below
    }
  }

  if (envelope?.is_error) {
    const apiStatus = (envelope as { api_error_status?: number }).api_error_status;
    const hint =
      apiStatus === 401
        ? '\nHint: 401 = bad/missing credentials. The brief command uses your local `claude` CLI OAuth by default. If you have a stale ANTHROPIC_API_KEY in .env, remove it (it is now optional). To force API-key billing, set DD_USE_ANTHROPIC_API_KEY=1.'
        : '';
    throw new Error(
      `claude CLI reported error${apiStatus ? ` (HTTP ${apiStatus})` : ''}: ${envelope.result ?? envelope.subtype ?? 'unknown'}${hint}`,
    );
  }

  if (exitCode !== 0) {
    throw new Error(
      `claude CLI exited ${exitCode}\nstderr: ${stderrText.slice(0, 500) || '(empty)'}\nstdout: ${stdoutText.slice(0, 500) || '(empty)'}`,
    );
  }

  if (!envelope) {
    throw new Error(`claude CLI returned non-JSON output:\n${stdoutText.slice(0, 500)}`);
  }

  // With --json-schema set, validated structured output lives here.
  if (envelope.structured_output !== undefined) {
    return envelope.structured_output;
  }

  // Fallback: parse the model's text output. Should rarely trigger when
  // --json-schema is honored, but kept defensive.
  if (typeof envelope.result === 'string') {
    return JSON.parse(stripCodeFences(envelope.result));
  }

  throw new Error('claude CLI returned no structured_output and no parseable result');
}

/**
 * Generate a dividend brief end-to-end: fetch 10-K → extract relevant
 * section → ask Claude → validate JSON → return.
 */
export async function generateBrief(
  ticker: string,
  opts: BriefOptions = {},
): Promise<DividendBrief> {
  const tenK = await fetchLatest10K(ticker);
  if (!tenK) {
    throw new Error(`No 10-K found for ${ticker} (likely an ETF; AI brief not applicable).`);
  }

  const text = plainTextFromHtml(tenK.body);
  const focused = extractDividendSection(text, opts.maxTenKChars ?? 60_000);

  const userContent = [
    `Ticker: ${tenK.ticker}`,
    `Filing date: ${tenK.filingDate}`,
    `10-K URL: ${tenK.url}`,
    '',
    '--- BEGIN 10-K EXCERPT (focused on dividend / liquidity sections) ---',
    focused,
    '--- END 10-K EXCERPT ---',
    opts.earningsCallText
      ? `\n--- BEGIN EARNINGS CALL ---\n${opts.earningsCallText}\n--- END ---`
      : '',
    '',
    `Produce the JSON brief for ${tenK.ticker} matching the schema. Use ticker="${tenK.ticker}" and filingDate="${tenK.filingDate}".`,
  ].join('\n');

  const claudeBin = opts.claudeBin ?? process.env.CLAUDE_BIN ?? 'claude';
  const model = opts.model ?? 'claude-opus-4-7';

  const parsed = await callClaudeCli({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: userContent,
    jsonSchema: BRIEF_JSON_SCHEMA,
    model,
    claudeBin,
  });

  // Backfill ticker/filingDate from our metadata if the model omitted them
  // (shouldn't happen with --json-schema's required[] enforcement, but
  // belt-and-suspenders).
  if (typeof parsed === 'object' && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (!obj.ticker) obj.ticker = tenK.ticker;
    if (!obj.filingDate) obj.filingDate = tenK.filingDate;
  }

  const validated = BriefSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`Brief failed schema validation: ${validated.error.message}`);
  }
  return validated.data;
}

function stripCodeFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

/**
 * Format a brief as Markdown for a Discord digest or terminal output.
 */
export function formatBriefMarkdown(b: DividendBrief): string {
  const healthEmoji = {
    robust: '🟢',
    stable: '🟡',
    watch: '🟠',
    fragile: '🔴',
  }[b.dividendHealth];

  const lines = [
    `### ${b.ticker} — ${healthEmoji} ${b.dividendHealth.toUpperCase()} (10-K filed ${b.filingDate})`,
    `**Thesis:** ${b.oneLineThesis}`,
    '',
    `**Payout policy:** ${b.payoutPolicySummary}`,
    `**Mgmt guidance:** ${b.managementGuidance}`,
    `**12-mo cut probability:** ${b.cutProbability12mo}  ·  **LLM confidence:** ${b.confidence}`,
  ];

  if (b.recentChanges.length > 0) {
    lines.push('', '**Recent changes:**');
    for (const c of b.recentChanges) lines.push(`- ${c}`);
  }
  if (b.positiveSignals.length > 0) {
    lines.push('', '**Positive signals:**');
    for (const s of b.positiveSignals) lines.push(`- ${s}`);
  }
  if (b.riskFlags.length > 0) {
    lines.push('', '**Risk flags:**');
    for (const r of b.riskFlags) lines.push(`- ${r}`);
  }

  return lines.join('\n');
}
