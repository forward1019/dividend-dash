import { z } from 'zod';

// === Brokers ===
export const BrokerSchema = z.enum(['fidelity', 'robinhood', 'ibkr', 'manual', '401k']);
export type Broker = z.infer<typeof BrokerSchema>;

// === Transaction types ===
export const TxnTypeSchema = z.enum([
  'buy',
  'sell',
  'dividend',
  'split',
  'transfer_in',
  'transfer_out',
  'fee',
  'other',
]);
export type TxnType = z.infer<typeof TxnTypeSchema>;

// === Dividend frequency ===
export const FrequencySchema = z.enum([
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'special',
  'unknown',
]);
export type Frequency = z.infer<typeof FrequencySchema>;

// === Holding ===
export const HoldingSchema = z.object({
  broker: BrokerSchema,
  account: z.string().min(1),
  ticker: z.string().min(1).toUpperCase(),
  shares: z.number().nonnegative(),
  costBasisCents: z.number().int(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type Holding = z.infer<typeof HoldingSchema>;

// === Transaction ===
export const TransactionSchema = z.object({
  broker: BrokerSchema,
  account: z.string().min(1),
  ticker: z.string().min(1).toUpperCase(),
  txnType: TxnTypeSchema,
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shares: z.number().nullable().optional(),
  priceCents: z.number().int().nullable().optional(),
  amountCents: z.number().int(),
  feesCents: z.number().int().nonnegative().default(0),
  notes: z.string().nullable().optional(),
  sourceFile: z.string().nullable().optional(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

// === Dividend event (per-share, security-level) ===
export const DividendEventSchema = z.object({
  ticker: z.string().min(1).toUpperCase(),
  exDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  recordDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  declaredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  amountPerShareMicros: z.number().int().nonnegative(),
  frequency: FrequencySchema.optional(),
  source: z.enum(['yfinance', 'sec_edgar', 'polygon', 'manual']),
});
export type DividendEvent = z.infer<typeof DividendEventSchema>;
