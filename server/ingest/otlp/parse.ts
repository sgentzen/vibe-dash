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
        const metricName = (metric as { name?: unknown }).name;
        if (typeof metricName !== "string") continue;

        const histogram = (metric as { histogram?: { aggregationTemporality?: unknown; dataPoints?: unknown } }).histogram;
        const sum = (metric as { sum?: { aggregationTemporality?: unknown; dataPoints?: unknown } }).sum;
        const container = histogram ?? sum;
        if (!container || !Array.isArray(container.dataPoints)) continue;

        const cumulative = isCumulative(container.aggregationTemporality);

        for (const dp of container.dataPoints) {
          const point = dp as Record<string, unknown>;
          // A histogram carries its total in `sum`; a Sum point carries it in
          // asDouble or asInt. `count` is the number of recorded observations,
          // never the quantity, so it is deliberately not a fallback here.
          const value = histogram
            ? asNumber(point.sum)
            : asNumber(point.asDouble) ?? asNumber(point.asInt);
          if (value === null) continue;

          const timeUnixNano = String(point.timeUnixNano ?? "");
          if (timeUnixNano === "") continue;

          points.push({
            metricName,
            resourceAttributes,
            scopeName,
            attributes: flattenAttributes(point.attributes),
            timeUnixNano,
            startTimeUnixNano: String(point.startTimeUnixNano ?? timeUnixNano),
            value,
            cumulative,
          });
        }
      }
    }
  }

  return points;
}
