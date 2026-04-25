/**
 * AI dividend brief: Claude reads the latest 10-K (and optionally an
 * earnings call transcript) and produces a structured assessment of the
 * dividend story.
 *
 * Uses prompt caching for the system prompt + the (long) 10-K body so
 * subsequent briefs against the same filing only pay output tokens.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { requireConfig } from '../lib/config.ts';
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
- Output ONLY the JSON object matching the schema. No preamble, no markdown fences.`;

const SCHEMA_HINT = `Output JSON with exactly these fields:
{
  "ticker": string,
  "filingDate": string,
  "oneLineThesis": string,
  "dividendHealth": "robust" | "stable" | "watch" | "fragile",
  "payoutPolicySummary": string,
  "managementGuidance": string,
  "recentChanges": string[],
  "positiveSignals": string[],
  "riskFlags": string[],
  "cutProbability12mo": "low" | "medium" | "high",
  "confidence": "low" | "medium" | "high"
}`;

export interface BriefOptions {
  /** Override the model. Defaults to claude-opus-4-7 per docs/decisions.md. */
  model?: string;
  /** Optional earnings call transcript text (Phase 5+ enhancement). */
  earningsCallText?: string;
  /** Cap on 10-K text passed to the model. Default 60k characters. */
  maxTenKChars?: number;
}

/**
 * Generate a dividend brief end-to-end: fetch 10-K → extract relevant
 * section → ask Claude → validate JSON → return.
 */
export async function generateBrief(
  ticker: string,
  opts: BriefOptions = {},
): Promise<DividendBrief> {
  const apiKey = requireConfig('anthropicApiKey');
  const client = new Anthropic({ apiKey });

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
    SCHEMA_HINT,
    '',
    '--- BEGIN 10-K EXCERPT (focused on dividend / liquidity sections) ---',
    focused,
    '--- END 10-K EXCERPT ---',
    opts.earningsCallText
      ? `\n--- BEGIN EARNINGS CALL ---\n${opts.earningsCallText}\n--- END ---`
      : '',
    '',
    `Produce the JSON brief for ${tenK.ticker}.`,
  ].join('\n');

  const model = opts.model ?? 'claude-opus-4-7';

  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: userContent,
            // Cache the long 10-K excerpt so repeat briefs / regeneration
            // are cheap.
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ],
  });

  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('Claude returned no text block');
  }

  const json = stripCodeFences(block.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `Brief response was not valid JSON: ${(err as Error).message}\n${json.slice(0, 500)}`,
    );
  }

  // Default ticker/filingDate from our metadata if the model omitted them
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
