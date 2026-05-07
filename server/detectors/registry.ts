import type Database from "better-sqlite3";
import type { Detector, DetectorContext, ScoredMatch } from "./types.js";

const REGISTRY: Detector[] = [];

export function registerDetector(d: Detector): void {
  if (REGISTRY.some((r) => r.id === d.id)) {
    throw new Error(`Detector '${d.id}' is already registered`);
  }
  REGISTRY.push(d);
}

export function listDetectors(): readonly Detector[] {
  return REGISTRY;
}

// Comma-separated detector IDs that are suppressed at runtime.
// Set VIBE_SUPPRESS_DETECTORS=blocker-aging,agent-silence to silence specific detectors.
function suppressedIds(): Set<string> {
  const raw = process.env.VIBE_SUPPRESS_DETECTORS ?? "";
  return new Set(raw.split(",").filter(Boolean));
}

export interface RunOptions {
  // Override the global threshold — matches with score < threshold are dropped.
  // Defaults to each detector's defaultThreshold.
  minScore?: number;
  // Restrict run to a specific detector ID.
  detectorId?: string;
}

export function runDetectors(db: Database.Database, options: RunOptions = {}): ScoredMatch[] {
  const ctx: DetectorContext = { db, now: new Date().toISOString() };
  const suppressed = suppressedIds();
  const results: ScoredMatch[] = [];

  for (const d of REGISTRY) {
    if (suppressed.has(d.id)) continue;
    if (options.detectorId && d.id !== options.detectorId) continue;

    let matches;
    try {
      matches = d.predicate(ctx);
    } catch {
      // Individual detector failures must not crash the runner.
      continue;
    }

    for (const match of matches) {
      let score: number;
      try {
        score = Math.max(0, Math.min(100, Math.round(d.score(match, ctx))));
      } catch {
        continue;
      }

      const threshold = options.minScore !== undefined ? options.minScore : d.defaultThreshold;
      if (score < threshold) continue;

      results.push({ ...match, detectorId: d.id, category: d.category, score });
    }
  }

  // Highest score first.
  return results.sort((a, b) => b.score - a.score);
}

// Exported for testing — resets registry to empty.
export function _resetRegistry(): void {
  REGISTRY.length = 0;
}
