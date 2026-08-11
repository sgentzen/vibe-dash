// Attribute values on an OTLP point come off the wire from whatever process is
// pointed at the receiver. Where those values are used as object keys, a name
// that exists on Object.prototype resolves to an inherited member instead of
// missing. The member is truthy, so a "did we find it" guard passes and the
// code proceeds on a value that is a function rather than a rate or a token
// kind. Both call sites now look up through Object.hasOwn.
import { describe, it, expect } from "vitest";
import { mapPoint } from "../server/ingest/otlp/mappers/index.js";
import { priceTokens } from "../server/ingest/transcripts/pricing.js";
import type { OtlpPoint } from "../server/ingest/otlp/types.js";

const INHERITED = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"];

function point(attributes: Record<string, string>): OtlpPoint {
  return {
    metricName: "codex.turn.token_usage",
    resourceAttributes: {},
    scopeName: "codex",
    attributes,
    timeUnixNano: "2000",
    startTimeUnixNano: "1000",
    value: 100,
    cumulative: false,
  };
}

const NO_TOKENS = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
};

describe("a token_type naming an inherited property", () => {
  it.each(INHERITED)("leaves %s unmapped rather than mapping to a function", (name) => {
    // Before the guard this returned a truthy MappedUsage whose kind was
    // Object.prototype.constructor, so the tokens were carried into the
    // pipeline under a kind that matches no bucket.
    expect(mapPoint(point({ token_type: name, model: "gpt-5.3-codex" }))).toBeNull();
  });

  it("still maps a real token type", () => {
    expect(mapPoint(point({ token_type: "input", model: "gpt-5.3-codex" })))
      .toEqual({ model: "gpt-5.3-codex", kind: "input" });
  });
});

describe("a model naming an inherited property", () => {
  it.each(INHERITED)("prices %s as unknown rather than NaN", (name) => {
    // Before the guard this returned NaN, because the inherited member is
    // truthy but has no .input, and NaN * tokens is NaN. A NaN in cost_usd is
    // worse than an unpriced row: it is a corrupt figure rather than an absent
    // one, and nothing downstream distinguishes it.
    const cost = priceTokens({ ...NO_TOKENS, model: name, inputTokens: 1_000_000 });
    expect(cost).toBeNull();
    expect(Number.isNaN(cost)).toBe(false);
  });

  it("still prices a known model", () => {
    expect(priceTokens({ ...NO_TOKENS, model: "gpt-5.3-codex", inputTokens: 1_000_000 }))
      .toBeCloseTo(1.75, 6);
  });

  it("still prices a known model in fast mode", () => {
    // The fast path has its own lookup and needs the same guard.
    expect(priceTokens({ ...NO_TOKENS, model: "claude-opus-5", speed: "fast", inputTokens: 1_000_000 }))
      .toBeCloseTo(10, 6);
  });
});
