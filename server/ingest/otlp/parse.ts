import type { OtlpPoint } from "./types.js";

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
 * exporters genuinely differ, so both are read. Anything unrecognised is
 * treated as delta, which is the OTLP default for a field left unset.
 */
function isCumulative(raw: unknown): boolean {
  return raw === 2 || raw === "AGGREGATION_TEMPORALITY_CUMULATIVE";
}

/** 64-bit ints arrive as strings under the protobuf JSON mapping. */
function asNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
 * same series — and `seriesIncrement` (series.ts) treats any change in start
 * time as a process restart, re-recording the whole cumulative value as new
 * spend on every export. A constant default ("") keeps it stable across
 * exports of the same series instead, so restart detection falls back to the
 * value-going-backwards rule in series.ts, which exists for exactly this
 * case: a sender whose start time cannot be used to spot a restart.
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
    throw new Error("OTLP payload must be a JSON object");
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
