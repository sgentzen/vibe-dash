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

  it("skips a histogram point with no sum rather than treating it as zero", () => {
    const payload = histogramPayload();
    // Remove the sum field entirely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
