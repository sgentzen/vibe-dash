# Ad Hoc Change Detection — Design

**Date:** 2026-05-16
**Status:** Approved (revised to extend existing detector framework)
**Author:** Scott + Claude

## Problem

Project state in vibe-dash drifts in ways the structured task/milestone flow doesn't capture. Three classes of drift matter most:

1. **Scope/direction pivots** — milestones get redefined mid-flight
2. **Unplanned work** — commits shipped without a linked task
3. **Activity bursts** — sudden spikes in an area outside any planned task

Today these only surface if a human writes a note. We want them surfaced automatically with no manual capture burden, alongside the existing tier-1 and tier-2 detectors.

## Goals

- Auto-detect three new ad hoc change classes
- Reuse the existing `server/detectors/` framework (`predicate → Match[] → /api/detectors/matches → HotSpotsView`)
- Persist source data (commits, milestone history) so predicates can query the DB without external calls at request time

## Non-goals

- Manual note capture (out of scope — pure auto-detect)
- New emission pipeline / `activity_log` writes for detector results — detectors return `Match[]`, the existing render surface handles display
- Confirm/dismiss UX — user can suppress detectors via `VIBE_SUPPRESS_DETECTORS` env var (existing mechanism)
- New UI surface — `HotSpotsView` already renders all detector matches; this spec adds icons/labels for the new entity types but no new screens
- Multi-repo support — single local git path only in v1
- Per-project burst thresholds — global threshold only in v1
- Backfill of historical commits or milestone history older than the table's creation

## Architecture

```
server/
  detectors/
    types.ts          # MODIFY: add 'commit' | 'milestone' | 'area' to EntityType
    tier3.ts          # NEW: unlinked-commit, scope-change, activity-burst
    index.ts          # MODIFY: export registerTier3Detectors
  db/
    schema.ts         # unchanged (delegates to migrator)
    migrator.ts       # MODIFY: add migration for commits + milestone_history tables
    milestones.ts     # MODIFY: hook updateMilestone to write milestone_history
    commits.ts        # NEW: CRUD for commits table
    milestone_history.ts # NEW: CRUD for milestone_history table
  ingestion/
    commits.ts        # NEW: scheduled git-log poll that upserts commits
  index.ts            # MODIFY: register tier3, start commit ingestion loop
shared/
  types.ts            # MODIFY: extend EntityType to match server (UI consumes)
src/
  components/
    HotSpotsView.tsx  # MODIFY: add icons + click targets for new entity types
tests/
  detectors-tier3.test.ts        # NEW
  ingestion-commits.test.ts      # NEW
  milestone_history.test.ts      # NEW
```

## Data model

### Two new tables (single migration)

```sql
-- Local git commits, populated by ingestion loop.
CREATE TABLE commits (
  sha TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  author_email TEXT,
  authored_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  linked_task_id TEXT REFERENCES tasks(id)  -- nullable; set if subject mentions a known task id
);
CREATE INDEX idx_commits_authored_at ON commits(authored_at);
CREATE INDEX idx_commits_linked_task_id ON commits(linked_task_id);

-- Audit log of milestone field changes that signal scope pivots.
CREATE TABLE milestone_history (
  id TEXT PRIMARY KEY,
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  field TEXT NOT NULL,            -- 'name' | 'description' | 'target_date' | 'acceptance_criteria'
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX idx_milestone_history_milestone_id ON milestone_history(milestone_id);
CREATE INDEX idx_milestone_history_changed_at ON milestone_history(changed_at);
```

No state table for detectors — matches are computed per request, matching existing tier-1/2 behavior. Idempotency lives in the source tables (commits dedupe on `sha`; milestone_history is append-only).

### EntityType extension

```ts
// server/detectors/types.ts (before): "task" | "agent" | "blocker" | "review"
// after:                              "task" | "agent" | "blocker" | "review" | "commit" | "milestone" | "area"
```

`shared/types.ts` mirrors this for the UI.

## Commit ingestion (separate from detector framework)

Detectors query the DB; they don't shell out to git. A small ingestion module keeps the `commits` table fresh.

**Module:** `server/ingestion/commits.ts`

**Behavior:**
- On start, run `git log --since=<7 days ago> --format=%H%x00%s%x00%ae%x00%aI` once
- Then every `COMMIT_INGEST_INTERVAL_MS` (default 5 min), run `git log --since=<last ingested_at - 1h>` (1h buffer for clock skew)
- For each row: `INSERT OR IGNORE INTO commits` (dedupe on `sha`)
- For each new commit, regex-match the subject for known task IDs and set `linked_task_id`. Task ID regex: built from `tasks.id` values, plus a `[VD-\w+]` convention if present
- All git calls go through a `gitLog()` wrapper in `server/ingestion/gitLog.ts` that's stubbable in tests via dependency injection

**Disable conditions (one-time warning at startup, then no-op):**
- `git` not installed
- `GIT_REPO_PATH` (default `process.cwd()`) is not a git repository
- `COMMIT_INGEST_ENABLED=false`

## Milestone history hook

`server/db/milestones.ts → updateMilestone` is modified to: before applying the UPDATE, fetch the current row; for each watched field (`name`, `description`, `target_date`, `acceptance_criteria`) where the new value differs from the old, insert a `milestone_history` row.

This is a small inline change (~15 lines) and does not require a new module.

## Detectors

All three follow the existing `Detector` interface (`id`, `category`, `defaultThreshold`, `predicate`, `score`).

### `unlinked-commit`

- **Category:** `change`
- **Default threshold:** 50
- **Predicate:** `SELECT * FROM commits WHERE linked_task_id IS NULL AND authored_at >= datetime('now', '-7 days')`
- **Score:** Constant 60 per commit (mild — frequent unlinked commits will surface in count, not severity)
- **Match:** `entityType: "commit"`, `entityId: sha`, `label: "Unlinked commit"`, `detail: subject + " · " + author_email`

### `scope-change`

- **Category:** `change`
- **Default threshold:** 50
- **Predicate:** `SELECT * FROM milestone_history WHERE changed_at >= datetime('now', '-30 days')` — one match per row
- **Score:**
  - `field = 'name'` → 90 (renaming a milestone mid-flight is a big signal)
  - `field = 'target_date'` → 80
  - `field = 'description'` or `'acceptance_criteria'` → 60
- **Match:** `entityType: "milestone"`, `entityId: milestone_id`, `label: "Milestone <name> <field> changed"`, `detail: "<old_value_truncated_80> → <new_value_truncated_80>"`

### `activity-burst`

- **Category:** `change`
- **Default threshold:** 60
- **Predicate (one match per area where burst detected):**
  1. Bucket recent `activity_log` rows by area. Area = first path segment of `task.title`-prefix tags if available, else "general". For v1, **bucket by project_id** (joined via `tasks.project_id` from `activity_log.task_id`) — keeps logic simple, no path heuristics needed
  2. Compute current-window count (last `DETECTOR_BURST_WINDOW_MIN` minutes, default 60) per bucket
  3. Compute 7-day baseline mean count for the same window length, per bucket
  4. Emit when `current > baseline × DETECTOR_BURST_THRESHOLD` (default 3.0) AND current ≥ 5 (suppress small-number noise)
- **Score:**
  - `ratio < 5` → 65
  - `5 ≤ ratio < 10` → 80
  - `ratio ≥ 10` → 95
- **Match:** `entityType: "area"`, `entityId: project_id`, `label: "Activity burst in <project_name>"`, `detail: "<N> events in <window_min>m, baseline <M>"`

### Registration

```ts
// server/detectors/tier3.ts
export function registerTier3Detectors(): void {
  registerDetector({ id: "unlinked-commit", category: "change", defaultThreshold: 50, predicate: unlinkedCommitPredicate, score: () => 60 });
  registerDetector({ id: "scope-change", category: "change", defaultThreshold: 50, predicate: scopeChangePredicate, score: scopeChangeScore });
  registerDetector({ id: "activity-burst", category: "change", defaultThreshold: 60, predicate: activityBurstPredicate, score: activityBurstScore });
}
```

Called from `server/detectors/index.ts` alongside `registerTier1Detectors()` and (future) `registerTier2Detectors()`.

## UI changes (`HotSpotsView.tsx`)

Minimal extensions to support the new entity types:

```ts
function entityIcon(entityType: ScoredMatch["entityType"]): string {
  switch (entityType) {
    case "blocker":   return "⊘";
    case "agent":     return "◉";
    case "review":    return "✗";
    case "task":      return "□";
    case "commit":    return "◇";   // NEW
    case "milestone": return "⤳";   // NEW
    case "area":      return "⚡";   // NEW
    default:          return "·";
  }
}
```

No new components, no routing changes. The existing AnomalyRow renders the new matches identically.

## Configuration

All env vars optional with sensible defaults.

| Variable | Default | Purpose |
|---|---|---|
| `COMMIT_INGEST_ENABLED` | `true` | Kill switch for commit ingestion loop |
| `COMMIT_INGEST_INTERVAL_MS` | `300000` (5 min) | Commit ingestion loop interval |
| `GIT_REPO_PATH` | `process.cwd()` | Working directory for `git log` |
| `DETECTOR_BURST_THRESHOLD` | `3.0` | Burst ratio multiplier |
| `DETECTOR_BURST_WINDOW_MIN` | `60` | Burst bucket window in minutes |
| `VIBE_SUPPRESS_DETECTORS` | unset | (existing) Comma-separated detector IDs to suppress |

## Error handling

- **Detector predicates:** existing registry already wraps each predicate in try/catch; a failing tier-3 detector is dropped from results without affecting others
- **Ingestion loop:** wrapped in try/catch per tick; logs to stderr and continues. A single failed tick does not stop the loop
- **Git unavailable:** ingestion logs one-time warning and disables itself for the process lifetime
- **Empty data:** all predicates handle empty tables gracefully (return `[]`)

## Testing

- `tests/detectors-tier3.test.ts` — uses `createTestDb()`, seeds rows in `commits` / `milestone_history` / `activity_log` directly (no git or scheduler), asserts predicate output and scoring. One block per detector.
- `tests/ingestion-commits.test.ts` — stubs `gitLog()` to return fixture commit data, asserts `commits` table population, dedupe on `sha`, and `linked_task_id` linking when subject matches.
- `tests/milestone_history.test.ts` — calls `updateMilestone()` with field changes, asserts `milestone_history` rows; calls with same values, asserts no rows written.
- Existing `tests/detectors.test.ts` registry behavior is unchanged and remains passing.

## Open questions

None — all design decisions made during brainstorming and reconciliation with the existing framework.

## Deferred to future work

- Multi-repo / per-project git config
- Per-project burst thresholds
- More sophisticated area bucketing (file-path-based, not project-based)
- A `tier3.ts` follow-up: detector for tasks reassigned more than N times in a window
- Surfacing tier-3 matches in the daily digest (relies on tier-2 wiring in `intelligence.ts`)
