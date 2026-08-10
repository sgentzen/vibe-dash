import type { UsageRecord } from "./types.js";

// Rates in USD per million tokens, from the `claude-api` skill (rates cached
// 2026-06-24). Static rather than fetched: a local-first tool that needs a
// network call to tell you what you spent has given up the property that makes
// it local-first, and a pricing endpoint is a dependency that can fail or
// disappear.
//
// REVIEW DATE: 2026-11-09. Anthropic publishes rate changes; nothing in this
// tool can detect a stale rate for a model that is still in the table, so this
// needs a human check each quarter. An unknown model is safe (it comes out
// unpriced); a silently wrong rate for a known model is not.
//
// KNOWN LIMITATION: Claude Sonnet 5 has introductory pricing of $2/$10 through
// 2026-08-31, after which it is $3/$15. The standard rate is used here, so
// Sonnet 5 spend inside the introductory window is OVERSTATED. Date-dependent
// rates were left out deliberately: overstating is the safer direction, and the
// alternative is a second class of bug in the money path. Documented in
// docs/ingestion.md.
interface Rate {
  input: number;
  output: number;
}

const RATES: Record<string, Rate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Fast mode runs the same model faster at premium pricing, so it needs its own
// row rather than a multiplier. Only Opus 5 and Opus 4.8 support it.
const FAST_RATES: Record<string, Rate> = {
  "claude-opus-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 10, output: 50 },
};

// Derived from the base input rate.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

const PER_MILLION = 1_000_000;

/**
 * Cost in USD for one usage record, or null when the model is unknown.
 *
 * Null is deliberate and is never coerced to zero: a silent zero would
 * understate spend and quietly corrupt the total this whole feature exists to
 * make trustworthy. An unpriced record still stores its tokens, so it can be
 * repriced later once the rate is known.
 */
export function priceRecord(record: UsageRecord): number | null {
  const table = record.speed === "fast" ? FAST_RATES : RATES;
  const rate = table[record.model] ?? (record.speed === "fast" ? RATES[record.model] : undefined);
  if (!rate) return null;

  const input = record.inputTokens * rate.input;
  const output = record.outputTokens * rate.output;
  const cacheRead = record.cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER;
  const write5m = record.cacheCreation5mTokens * rate.input * CACHE_WRITE_5M_MULTIPLIER;
  const write1h = record.cacheCreation1hTokens * rate.input * CACHE_WRITE_1H_MULTIPLIER;

  return (input + output + cacheRead + write5m + write1h) / PER_MILLION;
}

/** Exposed for the status endpoint so operators can see what is priceable. */
export function knownModels(): string[] {
  return Object.keys(RATES).sort((a, b) => a.localeCompare(b));
}
