import { describe, it, expect } from "vitest";
import { parseMetricsPayload } from "../server/ingest/otlp/parse.js";

function histogramPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "codex" } }] },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5-codex" } },
              ],
              startTimeUnixNano: "1000",
              timeUnixNano: "2000",
              count: "3",
              sum: 1500,
              ...overrides,
            }],
          },
        }],
      }],
    }],
  };
}

describe("parseMetricsPayload", () => {
  it("reads a histogram point's sum, not its count", () => {
    // count is the number of turns recorded, sum is the tokens.
    const [point] = parseMetricsPayload(histogramPayload());
    expect(point.value).toBe(1500);
    expect(point.metricName).toBe("codex.turn.token_usage");
  });

  it("flattens attributes and resource attributes", () => {
    const [point] = parseMetricsPayload(histogramPayload());
    expect(point.attributes).toEqual({ token_type: "input", model: "gpt-5-codex" });
    expect(point.resourceAttributes).toEqual({ "service.name": "codex" });
  });

  it("reads temporality given as an enum name", () => {
    expect(parseMetricsPayload(histogramPayload())[0].cumulative).toBe(false);
  });

  it("reads temporality given as an enum number", () => {
    // The protobuf JSON mapping permits either form, and exporters differ.
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "m",
          histogram: {
            aggregationTemporality: 2,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum: 5 }],
          },
        }] }],
      }],
    };
    expect(parseMetricsPayload(payload)[0].cumulative).toBe(true);
  });

  it("reads temporality given as a quoted enum number", () => {
    // Some exporters send the number itself as a JSON string ("2") rather than
    // a bare number. Before this was recognised, a quoted "2" fell through to
    // the delta default -- which is the interpretation that re-records a
    // cumulative sender's running total as new spend on every export.
    const withTemporality = (aggregationTemporality: unknown) => ({
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "m",
          histogram: {
            aggregationTemporality,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum: 5 }],
          },
        }] }],
      }],
    });

    expect(parseMetricsPayload(withTemporality("2"))[0].cumulative).toBe(true);
    expect(parseMetricsPayload(withTemporality("1"))[0].cumulative).toBe(false);
    expect(parseMetricsPayload(withTemporality(1))[0].cumulative).toBe(false);
  });

  it("treats UNSPECIFIED (0) as delta, a deliberate choice rather than the spec's own default", () => {
    // The proto default for an unset aggregationTemporality is UNSPECIFIED
    // (0), not DELTA -- this pins the code's chosen fallback rather than
    // implying the spec assigns it.
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "m",
          histogram: {
            aggregationTemporality: 0,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum: 5 }],
          },
        }] }],
      }],
    };
    expect(parseMetricsPayload(payload)[0].cumulative).toBe(false);
  });

  it("falls back to delta for a missing, null, or otherwise malformed aggregationTemporality", () => {
    // classifyTemporality (parse.ts) reads this field with Set.has against
    // attacker-controlled JSON. None of these shapes should throw or be
    // misclassified as cumulative -- they should all land on the same
    // documented delta fallback as UNSPECIFIED.
    const withTemporality = (aggregationTemporality: unknown) => {
      const metric: Record<string, unknown> = {
        name: "m",
        histogram: {
          dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum: 5 }],
        },
      };
      if (aggregationTemporality !== undefined) {
        (metric.histogram as Record<string, unknown>).aggregationTemporality = aggregationTemporality;
      }
      return {
        resourceMetrics: [{
          resource: { attributes: [] },
          scopeMetrics: [{ scope: { name: "s" }, metrics: [metric] }],
        }],
      };
    };

    expect(parseMetricsPayload(withTemporality(undefined))[0].cumulative).toBe(false);
    expect(parseMetricsPayload(withTemporality(null))[0].cumulative).toBe(false);
    expect(parseMetricsPayload(withTemporality({}))[0].cumulative).toBe(false);
    expect(parseMetricsPayload(withTemporality(true))[0].cumulative).toBe(false);
    expect(parseMetricsPayload(withTemporality("not-a-real-enum-value"))[0].cumulative).toBe(false);
  });

  it("reads a Sum point given asInt, which arrives as a string", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "claude_code.token.usage",
          sum: {
            aggregationTemporality: 1,
            isMonotonic: true,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", asInt: "42" }],
          },
        }] }],
      }],
    };
    const [point] = parseMetricsPayload(payload);
    expect(point.value).toBe(42);
    expect(point.metricName).toBe("claude_code.token.usage");
  });

  it("gives points missing startTimeUnixNano a value that does not vary with timeUnixNano", () => {
    // startTimeUnixNano is optional in OTLP. Defaulting an absent one to the
    // point's own timeUnixNano would make it different on every export of the
    // same series. seriesIncrement (series.ts) no longer uses start time to
    // detect a restart at all, but the field is still stored for diagnostics,
    // so it should still be stable across exports of the same series rather
    // than churning for no reason. Two points of the same series exported at
    // different times must resolve to the SAME startTimeUnixNano, whatever
    // that value is -- asserting the literal "" would pass for the wrong
    // reason if the sentinel ever changed.
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "m",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
            dataPoints: [
              { attributes: [], timeUnixNano: "1000", sum: 5 },
              { attributes: [], timeUnixNano: "2000", sum: 9 },
            ],
          },
        }] }],
      }],
    };
    const [first, second] = parseMetricsPayload(payload);
    expect(first.startTimeUnixNano).toBe(second.startTimeUnixNano);
  });

  it("skips a histogram point with no sum rather than treating it as zero", () => {
    const payload = histogramPayload();
    // Remove the sum field entirely.
    delete (payload as any).resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0].sum;
    expect(parseMetricsPayload(payload)).toEqual([]);
  });

  it("returns an empty list for a payload with no metrics", () => {
    expect(parseMetricsPayload({ resourceMetrics: [] })).toEqual([]);
    expect(parseMetricsPayload({})).toEqual([]);
  });

  it("throws on a body that is not an object", () => {
    expect(() => parseMetricsPayload(null)).toThrow();
    expect(() => parseMetricsPayload("nope")).toThrow();
  });

  it("ignores gauge and other metric types it does not read", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "some.gauge",
          gauge: { dataPoints: [{ attributes: [], timeUnixNano: "2", asDouble: 3 }] },
        }] }],
      }],
    };
    expect(parseMetricsPayload(payload)).toEqual([]);
  });
});

// A quantity has to be a number we can honestly record, not merely a finite
// one. `sum: 1e308` is finite, so it used to produce a row of 1e308 tokens
// costing 1.75e302 dollars, and because no cost row is ever deleted that
// permanently corrupted every aggregate it landed in.
describe("implausible quantities", () => {
  function withSum(sum: unknown): unknown {
    return {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: 1,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum }],
          },
        }] }],
      }],
    };
  }

  it("skips a value beyond exact integer representation", () => {
    expect(parseMetricsPayload(withSum(1e308))).toEqual([]);
  });

  it("skips a value just past MAX_SAFE_INTEGER", () => {
    // The boundary is where integer arithmetic stops being exact, not an
    // arbitrary "too big to be real" threshold.
    expect(parseMetricsPayload(withSum(Number.MAX_SAFE_INTEGER + 2))).toEqual([]);
  });

  it("keeps a value at exactly MAX_SAFE_INTEGER", () => {
    expect(parseMetricsPayload(withSum(Number.MAX_SAFE_INTEGER))[0].value).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("skips a negative quantity", () => {
    // Nonsense in the money path should stop at the first gate that sees it,
    // even though the ingest layer would also skip a non-positive increment.
    expect(parseMetricsPayload(withSum(-5))).toEqual([]);
  });

  it("still skips an overflowing string, as before", () => {
    expect(parseMetricsPayload(withSum("1e999"))).toEqual([]);
  });

  it("keeps an ordinary token count", () => {
    expect(parseMetricsPayload(withSum(1500))[0].value).toBe(1500);
  });
});
