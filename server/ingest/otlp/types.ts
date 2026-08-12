/** One normalised metric data point, independent of which runner sent it. */
export interface OtlpPoint {
  metricName: string;
  /** Resource-level attributes, flattened. Carries the project hint, if any. */
  resourceAttributes: Record<string, string>;
  scopeName: string;
  /** Point-level attributes, flattened. Carries token_type and model. */
  attributes: Record<string, string>;
  timeUnixNano: string;
  startTimeUnixNano: string;
  value: number;
  /** True when the value is a running total rather than an interval. */
  cumulative: boolean;
}

/** What a runner mapper extracts from one point. */
export interface MappedUsage {
  model: string;
  /** Which token bucket this point's value belongs to. */
  kind: "input" | "output" | "cacheRead";
}

/**
 * What a mapper decided about one point.
 *
 * "unmapped" means no mapper recognised the METRIC NAME at all. This is the
 * only status that should ever move `otlpUnmapped` (ingest.ts), because that
 * counter has one job (spec §7): telling an operator their runner is not
 * recognised. "ignored" means a mapper DID recognise the metric but chose,
 * for a reason internal to that runner, not to turn this particular point
 * into usage -- Codex's `token_type = "total"` (the sum of the other buckets,
 * which would double every figure if counted) or a point missing the model
 * attribute. Those are working-as-designed skips of a runner we DO recognise,
 * and folding them into "unmapped" is exactly the bug this type exists to
 * prevent: it made `otlpUnmapped` climb forever on a perfectly working Codex
 * setup, unable to do the one job it has.
 */
export type MapResult =
  | { status: "mapped"; usage: MappedUsage }
  | { status: "ignored" }
  | { status: "unmapped" };
