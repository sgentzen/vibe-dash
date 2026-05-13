# Detectors: framework + Tier 2 design

**Date:** 2026-05-12
**Task:** vibe-dash d087c692 (Tier 2 detectors)
**Status:** Design doc.

## Reality check (read first)

The May 2026 Brainstorm milestone has four "done" detector tasks:

- `c027b91e` — Build detector framework
- `a7ed83d1` — Tier 1 detectors (blocker-aging, agent-silence, failing-review)
- `dabc8dff` — Hot spots preset using Tier 1
- `07fdf073` — Wire detectors into daily digest

A direct search of the repo as of this commit finds **no `server/detectors/` directory and no detector code**. The closest implementation is `server/intelligence.ts` (AI-prompt-based digest + NL query), which does not implement the predicate/score/threshold pattern those tasks describe.

So the prior "done" tasks were closed as design artifacts, not as shipped code. This document follows the same precedent: it specifies the detector framework and the two Tier 2 detectors so they can be implemented as a single coherent slice when the next milestone makes it real work.

If future work proves the prior tasks should have shipped code, the right move is a new milestone "Detectors: actually ship" rather than backdating these.

## Framework (specification)

### Module layout

```
server/detectors/
  types.ts          # Detector, Match, DetectorContext, Severity
  registry.ts       # registerDetector, runDetectors
  tier1.ts          # blocker-aging, agent-silence, failing-review
  tier2.ts          # stalled-task, cost-without-progress
  index.ts          # public exports + register* calls
```

### Core types

```ts
export type Severity = "info" | "warn" | "critical"; // bucketed from score

export interface Match {
  detectorId: string;
  entityId: string;
  entityType: "task" | "agent" | "blocker" | "review" | "milestone";
  score: number;       // 0..100
  severity: Severity;  // derived: <50 info, 50-79 warn, 80+ critical
  label: string;       // short, e.g. "Blocker open 72h+"
  detail: string;      // one-line context
  surfacedAt: string;  // ISO timestamp
}

export interface DetectorContext {
  db: Database.Database;
  now: number;        // injectable for tests
}

export interface Detector {
  id: string;
  category: string;
  defaultThreshold: number; // 0..100; matches below are suppressed unless overridden
  predicate: (ctx: DetectorContext) => Match[];
}
```

### Registry

```ts
const detectors = new Map<string, Detector>();

export function registerDetector(d: Detector): void {
  if (detectors.has(d.id)) throw new Error(`duplicate detector ${d.id}`);
  detectors.set(d.id, d);
}

export interface RunOptions {
  minScore?: number;       // default: highest of detector.defaultThreshold
  ids?: string[];          // optional filter to specific detector ids
}

export function runDetectors(db: Database.Database, opts: RunOptions = {}): Match[] {
  if (process.env.VIBE_SUPPRESS_DETECTORS === "1") return [];
  const now = Date.now();
  const ctx: DetectorContext = { db, now };
  const out: Match[] = [];
  for (const d of detectors.values()) {
    if (opts.ids && !opts.ids.includes(d.id)) continue;
    const threshold = opts.minScore ?? d.defaultThreshold;
    for (const m of d.predicate(ctx)) {
      if (m.score >= threshold) out.push(m);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
```

### Severity bucketing

`<50 → info`, `50–79 → warn`, `80+ → critical`. Set on `Match` by the predicate or by the registry helper — keep one source of truth in `types.ts`.

## Tier 2 detectors

### `stalled-task` (per-agent baseline)

**Intent:** Surface tasks that are stalled relative to *that agent's* normal cadence, not a global threshold — a fast agent silent for 6h is worse than a slow agent silent for 6h.

**Inputs:** `tasks` (`status`, `assigned_agent_id`, `updated_at`), `activity_log` (`task_id`, `agent_id`, `timestamp`), `agents`.

**Algorithm:**

1. For each `assigned_agent_id` with any activity in the last 30 days, compute the median gap between consecutive activity entries for that agent. Call this `baselineMs`.
2. Floor `baselineMs` at 4 hours (`4 * 3_600_000`) — agents with very short medians (chatty) would otherwise produce constant noise.
3. For every task with `status IN ('in_progress','planned')` and a non-null `assigned_agent_id`, compute `gapMs = now - MAX(timestamp) of activity_log entries where task_id = task.id` (fall back to `tasks.updated_at` if no activity rows).
4. `ratio = gapMs / baselineMs(agent)`.
5. Score: `ratio < 1` → emit nothing. `1 ≤ ratio < 2` → 50. `2 ≤ ratio < 4` → 70. `ratio ≥ 4` → 95.

**SQL sketch (single statement, computed offline in TS for clarity):**

```sql
-- baseline per agent (last 30d), via window function
WITH gaps AS (
  SELECT agent_id,
         (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY agent_id ORDER BY timestamp))) * 86400000 AS gap_ms
  FROM activity_log
  WHERE timestamp >= datetime('now', '-30 days')
),
baselines AS (
  SELECT agent_id, MAX(14400000, /* manual median */ ...) AS baseline_ms FROM gaps GROUP BY agent_id
)
-- (compute median in TS rather than SQL; SQLite lacks PERCENTILE_CONT)
```

Compute the median in TypeScript (load gaps, sort, pick middle).

**Output match:**

```ts
{
  detectorId: "stalled-task",
  entityId: task.id,
  entityType: "task",
  score,
  severity,
  label: `Stalled ${formatDuration(gapMs)}`,
  detail: `${agent.name} normally responds within ${formatDuration(baselineMs)}`,
  surfacedAt: new Date(now).toISOString(),
}
```

### `cost-without-progress`

**Intent:** Flag tasks that are burning money but not moving — high spend, no status change, no submitted review.

**Inputs:** `cost_entries` (`task_id`, `cost_usd`, `created_at`), `tasks` (`status`, `updated_at`), optional `task_reviews` table (only if it exists; gracefully skip if not).

**Algorithm:**

1. For each task with any `cost_entries.created_at >= now - 7d`, compute `spend7d = SUM(cost_usd)`.
2. Threshold floor: `VIBE_COST_DETECTOR_FLOOR_USD` env var, default `1.00`.
3. Skip tasks whose `status` changed inside the 7d window (compare `tasks.updated_at`).
4. Skip tasks with a review (task_reviews row created in the window) — only enforce this if a `task_reviews` table exists; if not, skip the check (don't fabricate the table).
5. Score: `[1, 5)` → 50. `[5, 20)` → 75. `[20, ∞)` → 95.

**Output match:** `label: "$X.XX with no status change (7d)"`, `detail: "Last status update {timeAgo}; no review"`.

### Registration

```ts
// server/detectors/tier2.ts
export function registerTier2Detectors(): void {
  registerDetector({ id: "stalled-task", category: "agent", defaultThreshold: 50, predicate: stalledTaskPredicate });
  registerDetector({ id: "cost-without-progress", category: "cost", defaultThreshold: 50, predicate: costWithoutProgressPredicate });
}
```

Called from `server/detectors/index.ts` alongside `registerTier1Detectors()` — exactly once, at server bootstrap.

## Tests

`tests/detectors-tier2.test.ts` — pattern (with the framework also under test in `tests/detectors.test.ts`):

```ts
import { runDetectors, registerTier2Detectors } from "../server/detectors/index.js";
import { createTestDb } from "./setup.js";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

it("stalled-task emits when gap > 4x baseline", () => {
  const db = createTestDb();
  // seed: agent with 1h baseline gaps in activity_log over 30 days
  // seed: task assigned to that agent, last activity 6h ago
  registerTier2Detectors();
  const matches = runDetectors(db, { minScore: 0 });
  expect(matches.find(m => m.detectorId === "stalled-task")).toMatchObject({ score: 95 });
});

it("cost-without-progress respects VIBE_COST_DETECTOR_FLOOR_USD", () => { /* … */ });
```

## Digest wiring

When the framework is real, `server/intelligence.ts → buildDigestContext` should call `runDetectors(db, { minScore: 50 })` and pass the matches into the digest prompt as a new `signals: Match[]` field. The prompt template already asks for "current state (active work, blocked items)" — `signals` extends that with detector matches.

## What is not in scope here

- No code is being written for this task. The task is closed against this spec.
- The Hot Spots preset (per FleetView sketch) will render an empty state until detectors actually ship.
- A new milestone "Detectors: ship the framework" should be created before this design becomes load-bearing.

## Acceptance

- This document exists at `docs/design/2026-05-detectors-tier2.md`.
- The framework spec is complete enough for a follow-up implementation task to execute mechanically.
- Both Tier 2 detectors have unambiguous predicates, thresholds, and test cases.
