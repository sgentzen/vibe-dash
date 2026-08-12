import { describe, it, expect } from "vitest";
import { mapPoint } from "../server/ingest/otlp/mappers/index.js";
import type { OtlpPoint } from "../server/ingest/otlp/types.js";

function point(attributes: Record<string, string>, metricName = "codex.turn.token_usage"): OtlpPoint {
  return {
    metricName,
    resourceAttributes: {},
    scopeName: "codex",
    attributes,
    timeUnixNano: "2000",
    startTimeUnixNano: "1000",
    value: 100,
    cumulative: false,
  };
}

describe("the Codex mapper", () => {
  it("maps input tokens", () => {
    expect(mapPoint(point({ token_type: "input", model: "gpt-5-codex" })))
      .toEqual({ status: "mapped", usage: { model: "gpt-5-codex", kind: "input" } });
  });

  it("maps output tokens", () => {
    expect(mapPoint(point({ token_type: "output", model: "gpt-5-codex" })))
      .toEqual({ status: "mapped", usage: { model: "gpt-5-codex", kind: "output" } });
  });

  it("maps cached input to cache reads", () => {
    expect(mapPoint(point({ token_type: "cached_input", model: "gpt-5-codex" })))
      .toEqual({ status: "mapped", usage: { model: "gpt-5-codex", kind: "cacheRead" } });
  });

  it("bills reasoning output as output", () => {
    // A pricing judgement, not a name coincidence: reasoning tokens are billed
    // at the output rate.
    expect(mapPoint(point({ token_type: "reasoning_output", model: "gpt-5-codex" })))
      .toEqual({ status: "mapped", usage: { model: "gpt-5-codex", kind: "output" } });
  });

  it("IGNORES the total (not unmapped), which would otherwise double every figure", () => {
    // token_type=total is the sum of the other buckets and arrives beside
    // them. This must be "ignored", not "unmapped": the metric name IS
    // recognised (codex.turn.token_usage), so a working Codex setup sending
    // "total" every turn must not move the otlpUnmapped counter -- that was
    // the bug this status split fixed (see ingest.ts, buildGroups).
    expect(mapPoint(point({ token_type: "total", model: "gpt-5-codex" })))
      .toEqual({ status: "ignored" });
  });

  it("ignores a point with no model, rather than inventing one", () => {
    expect(mapPoint(point({ token_type: "input" }))).toEqual({ status: "ignored" });
  });

  it("ignores a token_type it does not recognise", () => {
    expect(mapPoint(point({ token_type: "something_new", model: "gpt-5-codex" })))
      .toEqual({ status: "ignored" });
  });

  it("does not map Claude Code metrics, by design, and reports it as unmapped", () => {
    // Claude Code is covered by transcript ingestion. Mapping it here would
    // create a third source competing for the same spend. Unlike the ignored
    // cases above, the metric name itself is unrecognised, so this IS
    // "unmapped".
    expect(mapPoint(point({ type: "input", model: "claude-opus-5" }, "claude_code.token.usage")))
      .toEqual({ status: "unmapped" });
  });

  it("does not map an unrelated metric, and reports it as unmapped", () => {
    expect(mapPoint(point({}, "codex.tool.call"))).toEqual({ status: "unmapped" });
  });
});
