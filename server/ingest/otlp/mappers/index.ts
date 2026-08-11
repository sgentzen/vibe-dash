import type { MapResult, OtlpPoint } from "../types.js";
import { mapCodexPoint } from "./codex.js";

/**
 * Every runner mapper, tried in order.
 *
 * Adding a runner is a new file here and its tests, with no change to the
 * endpoint, the temporality handling or the series store. Claude Code is
 * deliberately absent: it is covered by transcript ingestion, and a second
 * source for the same spend is how double counting starts.
 */
const MAPPERS = [mapCodexPoint];

/**
 * Run every mapper against this point and report what happened.
 *
 * A mapper returning anything other than "unmapped" means it recognised the
 * metric, so that result -- "mapped" or "ignored" -- is final; no other
 * mapper gets a turn. Only when every mapper says "unmapped" does the point
 * as a whole count as unmapped: no mapper recognised its metric name at all.
 */
export function mapPoint(point: OtlpPoint): MapResult {
  for (const mapper of MAPPERS) {
    const result = mapper(point);
    if (result.status !== "unmapped") return result;
  }
  return { status: "unmapped" };
}
