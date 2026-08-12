import { describe, it, expect } from "vitest";
import { priceTokens } from "../server/ingest/transcripts/pricing.js";

const EMPTY = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
};

describe("priceTokens", () => {
  it("prices a known model from its token counts", () => {
    // claude-opus-5 is $5/MTok in, $25/MTok out.
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(30, 10);
  });

  it("returns null for a model it does not know, never zero", () => {
    // Zero would read as free and understate the total. This is the invariant
    // the whole cost feature is built on.
    expect(priceTokens({ ...EMPTY, model: "no-such-model", inputTokens: 1_000_000 })).toBeNull();
  });

  it("applies the cache read discount", () => {
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", cacheReadTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.5, 10);
  });

  it("uses fast rates when speed is fast", () => {
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", speed: "fast", inputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(10, 10);
  });

  it("is zero for a known model with no tokens", () => {
    // Distinct from null: we know the rate, there was simply nothing to bill.
    expect(priceTokens({ ...EMPTY, model: "claude-opus-5" })).toBe(0);
  });

  it("prices a known Codex model from OpenAI's published rates", () => {
    // gpt-5.3-codex: $1.75/MTok in, $14.00/MTok out (platform.openai.com/docs/pricing).
    const cost = priceTokens({ ...EMPTY, model: "gpt-5.3-codex", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(15.75, 10);
  });

  it("applies the cache read discount to a Codex model", () => {
    expect(priceTokens({ ...EMPTY, model: "gpt-5.3-codex", cacheReadTokens: 1_000_000 })).toBeCloseTo(0.175, 10);
  });

  it("returns null for a Codex model that could not be verified against a primary source", () => {
    // "gpt-5-codex" is the model id seen in OTLP fixtures elsewhere in this repo,
    // but it is not the id currently listed on OpenAI's pricing page, so it is
    // deliberately not in the rate table. This documents that it stays unpriced
    // rather than being priced by resemblance to "gpt-5.3-codex".
    expect(priceTokens({ ...EMPTY, model: "gpt-5-codex", inputTokens: 1_000_000 })).toBeNull();
  });
});
