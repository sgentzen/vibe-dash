import type { OtlpPoint } from "./types.js";

/**
 * A body `parseMetricsPayload` refuses outright: not object-shaped OTLP at
 * all, so no retry of the same bytes could ever succeed.
 *
 * A distinct class rather than matching on the message, so the route can tell
 * "this will never parse" (400, do not retry) apart from every other failure
 * downstream, including a transient one (503, safe to retry — `external_id`
 * idempotency is exactly what makes that safe). Matching on message text would
 * break silently the first time this string is reworded.
 */
export class MalformedOtlpPayloadError extends Error {}

/**
 * Flatten OTLP's wrapped attribute list into a plain record.
 *
 * Only string values are kept. Token counts and model names are strings in
 * practice, and a partial record is safer than coercing an unexpected type
 * into one.
 */
function flattenAttributes(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const key = (entry as { key?: unknown }).key;
    const value = (entry as { value?: { stringValue?: unknown } }).value?.stringValue;
    if (typeof key === "string" && typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Whether an aggregationTemporality field means cumulative.
 *
 * The protobuf JSON mapping allows an enum as its name or its number, and
 * exporters genuinely differ on which they send -- and some additionally send
 * the number itself quoted (`"2"` rather than `2`). Both numeric and string
 * forms of both DELTA and CUMULATIVE are therefore recognised explicitly, so
 * a quoted `"2"` is read as cumulative rather than silently falling through
 * to the delta branch below, which is the interpretation that re-records a
 * running total as new spend on every export.
 *
 * Anything left over -- including UNSPECIFIED (0, the field's actual protobuf
 * default) and any value not recognised at all -- is treated as delta. This
 * is NOT something the spec mandates: the true default for an unset field is
 * UNSPECIFIED, not DELTA, and a given exporter's own effective default can be
 * either. Defaulting to delta here is a deliberate choice with a known risk:
 * if the point is actually cumulative, treating it as delta records its raw
 * running-total value instead of the increment, overstating spend on every
 * export (see D4 in the design doc). The alternative -- discarding a point
 * whose temporality cannot be determined -- trades that for silently losing
 * real spend from a genuinely-delta sender, which this project treats as
 * equally bad, not as the safer option.
 */
const CUMULATIVE_VALUES = new Set<unknown>([2, "2", "AGGREGATION_TEMPORALITY_CUMULATIVE"]);
const DELTA_VALUES = new Set<unknown>([1, "1", "AGGREGATION_TEMPORALITY_DELTA"]);

/** The three states the wire value can name -- "unspecified" also covers anything unrecognised. */
function classifyTemporality(raw: unknown): "cumulative" | "delta" | "unspecified" {
  if (CUMULATIVE_VALUES.has(raw)) return "cumulative";
  if (DELTA_VALUES.has(raw)) return "delta";
  return "unspecified";
}

function isCumulative(raw: unknown): boolean {
  // "delta" and "unspecified" both resolve to false here -- see the doc
  // comment above for why that default is deliberate, not spec-mandated.
  return classifyTemporality(raw) === "cumulative";
}

/** 64-bit ints arrive as strings under the protobuf JSON mapping. */
function asNumber(raw: unknown): number | null {
  if (typeof raw === "number") return boundedOrNull(raw);
  if (typeof raw === "string" && raw.trim() !== "") return boundedOrNull(Number(raw));
  return null;
}

/**
 * A quantity we are willing to treat as a token count.
 *
 * Finite is not enough. A point carrying `sum: 1e308` is finite, so it used to
 * be recorded, and it wrote a row of 1e308 tokens costing 1.75e302 dollars.
 * Because no cost row is ever deleted, that permanently corrupted every
 * aggregate it appeared in, with no supported way to remove it.
 *
 * MAX_SAFE_INTEGER is the bound rather than some larger "surely nobody" figure,
 * because it is where integer arithmetic stops being exact. A token count above
 * it cannot be represented faithfully, so it is not a number we can honestly
 * record whatever its provenance. Negative values are rejected here too, though
 * the ingest layer would also skip them: a negative token count is nonsense,
 * and nonsense in the money path should stop at the first gate that sees it.
 */
function boundedOrNull(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

/**
 * Resolve one data point's quantity.
 *
 * A histogram's total lives in `sum`; a Sum point's lives in `asDouble` or
 * `asInt`. `count` is the number of observations recorded, never the
 * quantity, so it is deliberately never read here — a missing `sum` is a
 * skipped point, not a substituted `count`.
 */
function resolvePointValue(point: Record<string, unknown>, isHistogram: boolean): number | null {
  return isHistogram ? asNumber(point.sum) : asNumber(point.asDouble) ?? asNumber(point.asInt);
}

/**
 * Resolve a data point's time fields.
 *
 * `startTimeUnixNano` is optional in OTLP. Defaulting an absent one to the
 * point's own `timeUnixNano` would make it different on every export of the
 * same series, which is exactly the shape of sender `seriesIncrement`
 * (series.ts) is written to tolerate: it no longer uses `startTimeUnixNano`
 * to detect a restart at all, precisely because senders vary here (some hold
 * it constant, some re-stamp it on every export while climbing normally). A
 * constant default ("") keeps this field stable across exports of the same
 * series regardless, since it is still stored for diagnostics even though it
 * is not part of the restart decision.
 *
 * Returns null when `timeUnixNano` itself is absent — unlike the start time,
 * that field is not optional, and a point without it cannot be placed in
 * time at all.
 */
function resolvePointTimes(
  point: Record<string, unknown>
): { timeUnixNano: string; startTimeUnixNano: string } | null {
  const timeUnixNano = String(point.timeUnixNano ?? "");
  if (timeUnixNano === "") return null;
  return { timeUnixNano, startTimeUnixNano: String(point.startTimeUnixNano ?? "") };
}

type MetricPointContainer = { aggregationTemporality?: unknown; dataPoints?: unknown };

/**
 * Parse one metric entry (a Sum or a Histogram) into its data points.
 *
 * Split out of `parseMetricsPayload` so each function's cognitive complexity
 * stays low: this handles one metric's worth of dataPoints, independent of
 * the resourceMetrics/scopeMetrics walk that finds it.
 */
function parseMetric(
  metric: unknown,
  resourceAttributes: Record<string, string>,
  scopeName: string
): OtlpPoint[] {
  const metricName = (metric as { name?: unknown }).name;
  if (typeof metricName !== "string") return [];

  const histogram = (metric as { histogram?: MetricPointContainer }).histogram;
  const sum = (metric as { sum?: MetricPointContainer }).sum;
  const container = histogram ?? sum;
  if (!container || !Array.isArray(container.dataPoints)) return [];

  const cumulative = isCumulative(container.aggregationTemporality);
  const points: OtlpPoint[] = [];

  for (const dp of container.dataPoints) {
    const point = dp as Record<string, unknown>;
    const value = resolvePointValue(point, Boolean(histogram));
    if (value === null) continue;

    const times = resolvePointTimes(point);
    if (times === null) continue;

    points.push({
      metricName,
      resourceAttributes,
      scopeName,
      attributes: flattenAttributes(point.attributes),
      timeUnixNano: times.timeUnixNano,
      startTimeUnixNano: times.startTimeUnixNano,
      value,
      cumulative,
    });
  }

  return points;
}

/**
 * Walk an OTLP/JSON ExportMetricsServiceRequest into flat points.
 *
 * Sums and histograms are both read. Histograms are what Codex sends; Sums are
 * what Claude Code sends, and although no mapper consumes them, they must be
 * parsed so those points can be COUNTED as unmapped rather than vanishing.
 * Silently ignoring a runner's data looks identical to it sending none.
 *
 * Throws only for a body that is not an object. A structurally odd but
 * object-shaped payload yields the points it can and skips the rest.
 */
export function parseMetricsPayload(body: unknown): OtlpPoint[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new MalformedOtlpPayloadError("OTLP payload must be a JSON object");
  }

  const points: OtlpPoint[] = [];
  const resourceMetrics = (body as { resourceMetrics?: unknown }).resourceMetrics;
  if (!Array.isArray(resourceMetrics)) return points;

  for (const rm of resourceMetrics) {
    const resourceAttributes = flattenAttributes(
      (rm as { resource?: { attributes?: unknown } }).resource?.attributes
    );
    const scopeMetrics = (rm as { scopeMetrics?: unknown }).scopeMetrics;
    if (!Array.isArray(scopeMetrics)) continue;

    for (const sm of scopeMetrics) {
      const scopeName = String((sm as { scope?: { name?: unknown } }).scope?.name ?? "");
      const metrics = (sm as { metrics?: unknown }).metrics;
      if (!Array.isArray(metrics)) continue;

      for (const metric of metrics) {
        points.push(...parseMetric(metric, resourceAttributes, scopeName));
      }
    }
  }

  return points;
}
