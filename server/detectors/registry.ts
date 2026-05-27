import type Database from "better-sqlite3";
import type { Detector, DetectorContext, ScoredMatch } from "./types.js";

const REGISTRY: Detector[] = [];

export function registerDetector(d: Detector): void {
  if (REGISTRY.some((r) => r.id === d.id)) {
    throw new Error(`Detector '${d.id}' is already registered`);
  }
  if (d.defaultThreshold < 0 || d.defaultThreshold > 100) {
    throw new Error(`Detector '${d.id}': defaultThreshold must be 0–100, got ${d.defaultThreshold}`);
  }
  REGISTRY.push(d);
}

export function listDetectors(): readonly Detector[] {
  return REGISTRY;
}

// Comma-separated detector IDs that are suppressed at runtime.
// Set VIBE_SUPPRESS_DETECTORS=blocker-aging,agent-silence to silence specific detectors.
// Re-reads env on every call so that test code can toggle suppression between runs
// without restarting the process.  In production the env never changes, so the
// overhead is one string split per request — acceptable.
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

function safePredicate(d: Detector, ctx: DetectorContext): ReturnType<Detector["predicate"]> {
  try {
    return d.predicate(ctx);
  } catch {
    return [];
  }
}

function safeScore(d: Detector, match: ReturnType<Detector["predicate"]>[number], ctx: DetectorContext): number | null {
  try {
    return Math.max(0, Math.min(100, Math.round(d.score(match, ctx))));
  } catch {
    return null;
  }
}

function runOneDetector(d: Detector, ctx: DetectorContext, options: RunOptions): ScoredMatch[] {
  const threshold = options.minScore !== undefined ? options.minScore : d.defaultThreshold;
  const out: ScoredMatch[] = [];
  for (const match of safePredicate(d, ctx)) {
    const score = safeScore(d, match, ctx);
    if (score === null || score < threshold) continue;
    out.push({ ...match, detectorId: d.id, category: d.category, score });
  }
  return out;
}

export function runDetectors(db: Database.Database, options: RunOptions = {}): ScoredMatch[] {
  const ctx: DetectorContext = { db, now: new Date().toISOString() };
  const suppressed = suppressedIds();
  const results: ScoredMatch[] = [];

  for (const d of REGISTRY) {
    if (suppressed.has(d.id)) continue;
    if (options.detectorId && d.id !== options.detectorId) continue;
    results.push(...runOneDetector(d, ctx, options));
  }

  // Highest score first.
  return results.sort((a, b) => b.score - a.score);
}

// Exported for testing — resets registry to empty.
export function _resetRegistry(): void {
  REGISTRY.length = 0;
}
