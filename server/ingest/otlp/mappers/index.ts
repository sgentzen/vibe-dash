import type { MappedUsage, OtlpPoint } from "../types.js";
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

/** The first mapper that recognises this point, or null if none does. */
export function mapPoint(point: OtlpPoint): MappedUsage | null {
  for (const mapper of MAPPERS) {
    const mapped = mapper(point);
    if (mapped) return mapped;
  }
  return null;
}
