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
