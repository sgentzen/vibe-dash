import { describe, it, expect } from "vitest";
import { priceRecord } from "../server/ingest/transcripts/pricing.js";
import type { UsageRecord } from "../server/ingest/transcripts/types.js";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    uuid: "u", sessionId: "s", timestamp: "2026-08-09T00:00:00.000Z",
    cwd: null, gitBranch: null, model: "claude-opus-5", speed: "standard",
    isSidechain: false, inputTokens: 0, outputTokens: 0,
    cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
    ...overrides,
  };
}

describe("priceRecord", () => {
  it("prices plain input and output tokens", () => {
    // Opus 5: $5/1M input, $25/1M output.
    const cost = priceRecord(record({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(30, 10);
  });

  it("prices cache reads at a tenth of input", () => {
    expect(priceRecord(record({ cacheReadTokens: 1_000_000 }))).toBeCloseTo(0.5, 10);
  });

  it("prices 5-minute cache writes at 1.25x input and 1-hour at 2x", () => {
    expect(priceRecord(record({ cacheCreation5mTokens: 1_000_000 }))).toBeCloseTo(6.25, 10);
    expect(priceRecord(record({ cacheCreation1hTokens: 1_000_000 }))).toBeCloseTo(10, 10);
  });

  it("prices fast mode on Opus 5 at its own higher rate", () => {
    // Fast mode is $10/$50 rather than $5/$25.
    const cost = priceRecord(record({ speed: "fast", inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(60, 10);
  });

  it("returns null for an unknown model rather than guessing zero", () => {
    expect(priceRecord(record({ model: "claude-something-unreleased", inputTokens: 999 }))).toBeNull();
  });

  it("returns 0, not null, for a known model with no tokens", () => {
    expect(priceRecord(record())).toBe(0);
  });

  it("prices the other current models", () => {
    expect(priceRecord(record({ model: "claude-sonnet-5", inputTokens: 1_000_000 }))).toBeCloseTo(3, 10);
    expect(priceRecord(record({ model: "claude-haiku-4-5", outputTokens: 1_000_000 }))).toBeCloseTo(5, 10);
    expect(priceRecord(record({ model: "claude-fable-5", outputTokens: 1_000_000 }))).toBeCloseTo(50, 10);
  });

  it("falls back to the standard rate for a model that has no fast tier", () => {
    expect(priceRecord(record({ model: "claude-sonnet-5", speed: "fast", inputTokens: 1_000_000 }))).toBeCloseTo(3, 10);
  });

  it("returns null for an unknown model even in fast mode", () => {
    expect(priceRecord(record({ model: "claude-unreleased", speed: "fast", inputTokens: 1_000_000 }))).toBeNull();
  });
});
