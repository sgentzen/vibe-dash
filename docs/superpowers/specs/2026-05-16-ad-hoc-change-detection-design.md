# Ad Hoc Change Detection — Design

**Date:** 2026-05-16
**Status:** Approved (brainstorming phase)
**Author:** Scott + Claude

## Problem

Project state in vibe-dash drifts in ways the structured task/milestone flow doesn't capture. Three classes of drift matter most:

1. **Scope/direction pivots** — milestones get redefined mid-flight
2. **Out-of-band decisions** — choices made outside any task
3. **Unplanned work** — commits shipped without a linked task

Today these only surface if a human writes a note. We want them surfaced automatically with no manual capture burden.

## Goals

- Auto-detect ad hoc changes from existing signals (git, DB mutations, activity volume)
- Surface them in the existing `ActivityStreamView` with visual distinction
- Persist to `activity_log` so they participate in WebSocket broadcast and existing filtering for free
- Keep each detector isolated, independently testable, and individually disable-able

## Non-goals

- Manual note capture (out of scope — pure auto-detect)
- New MCP tools (detectors are read-only consumers + activity_log writers)
- Multi-repo support (single `GIT_REPO_PATH` only)
- Per-project burst threshold tuning (global threshold only in v1)
- Confirm/dismiss UX for noisy events (auto-persist, user can filter source off)

## Architecture

Three independent detector modules driven by one scheduler, all writing through the existing `logActivity()` path so the WebSocket broadcast and ActivityStreamView pick them up unchanged.

```
server/
  detectors/
    types.ts            # Detector interface, DetectionResult
    index.ts            # Registry + runAll(db)
    scheduler.ts        # setInterval loop, try/catch per detector
    gitLog.ts           # Thin wrapper around `git log` (stubbable in tests)
    unlinkedCommit.ts   # Polling detector
    scopeChange.ts      # Event-driven (called from updateMilestone), also supports backfill
    burst.ts            # Polling detector with rolling baseline
```

### Detector interface

```ts
export interface Detector {
  name: string;
  run(db: Database.Database): Promise<DetectionResult>;
}

export interface DetectionResult {
  emitted: number;   // rows written this tick
  skipped: number;   // signals already seen (idempotent)
}
```

## Data model

### Reuse `activity_log`

All detected events become `activity_log` rows. No schema change to the table itself — only a convention for the `source` column:

| source                          | message format                                                        | task_id | agent_id |
|---------------------------------|-----------------------------------------------------------------------|---------|----------|
| `detector:unlinked-commit`      | `unlinked commit <sha7>: <subject>`                                   | null    | null     |
| `detector:scope-change`         | `milestone <name> <field> changed: <before> → <after>`                | null    | null     |
| `detector:burst`                | `activity burst in <area>: <N> events in <window>, baseline <M>`      | null    | null     |

### New `detector_state` table

For idempotency and rolling baselines:

```sql
CREATE TABLE detector_state (
  detector TEXT NOT NULL,        -- 'unlinked-commit' | 'scope-change' | 'burst'
  key TEXT NOT NULL,             -- commit sha, milestone_id+field, area bucket
  last_seen TEXT NOT NULL,       -- ISO 8601 timestamp
  payload TEXT,                  -- JSON; detector-specific (e.g. baseline counts for burst)
  PRIMARY KEY (detector, key)
);
```

- `unlinked-commit` writes one row per commit sha (`key = sha`) to avoid re-emitting on the next poll
- `scope-change` writes one row per `<milestone_id>:<field>` so backfills are idempotent
- `burst` writes one row per area bucket; `payload` stores the rolling 7-day hourly baseline

## Detectors

### unlinkedCommit

- Reads `git log --since=<last_seen> --format=%H%n%s` via `gitLog()` wrapper
- For each commit, checks subject against known task IDs (regex match against `tasks.id` rows, and the `[VD-xxx]` convention if present)
- If no match: write `activity_log` row with `source='detector:unlinked-commit'`, write `detector_state` row to mark seen
- Idempotent: skips commits already in `detector_state`

### scopeChange

- Not polled — called inline from `updateMilestone()` in `server/db/milestones.ts` when watched fields (`name`, `description`, `target_date`) change
- Diffs old vs new value, emits `activity_log` row with a human-readable before→after message
- Also implements the `Detector` interface so an operator can invoke it as a backfill (re-scan milestone history on demand)

### burst

- Every tick: bucket recent commits by top-level directory (from `git log --name-only --since=<DETECTOR_BURST_WINDOW_MIN>`)
- Compare current-window bucket count to the 7-day baseline (scaled to the same window length) stored in `detector_state.payload`
- Emit when `count > baseline × DETECTOR_BURST_THRESHOLD` (default 3.0)
- Update baseline using EWMA so it adapts over time
- One emission per bucket per window (idempotent via `detector_state.key = <area>:<windowBucket>`)

### Scheduler

- Started from `server/index.ts` after DB init, only if `DETECTOR_ENABLED !== 'false'`
- `setInterval` with `DETECTOR_INTERVAL_MS` (default 5 min)
- Iterates registered polling detectors, wraps each `run()` in try/catch
- A failing detector logs to stderr and is skipped this tick — never crashes the loop or other detectors
- Logs one-line summary per tick: `[detectors] unlinked-commit: 2 emitted, scope-change: 0, burst: 1`

### Startup backfill

- First scheduler run after process start: unlinked-commit scans last 7 days of git history; burst seeds baseline from last 7 days of `activity_log`; scope-change does nothing (event-driven)

## UI changes (`ActivityStreamView`)

Minimal — the stream already renders activity rows; detector rows just need a different look.

- **Visual:** subtle left border in an accent color, one per detector type (amber for scope-change, blue for unlinked-commit, magenta for burst). Small icon prefix. "detected" pill where the agent name would normally appear.
- **Filter:** new "Detected changes" chip in the existing filter bar, defaulting **on**. Backed by a new `sources?: string[]` field on `ActivityStreamFilter` in `server/db/activity.ts`; SQL gains a `source LIKE ANY` clause; route passes it through.
- **Click behavior:**
  - `scope-change` → link to milestone detail page
  - `unlinked-commit` → link to `<REPO_URL>/commit/<sha>` if `REPO_URL` env var is set, else plain text
  - `burst` → link to a filtered stream view scoped to the area + time window
- All changes confined to `src/components/ActivityStreamView.tsx` plus a small style addition. No new component files.

## Configuration

All env vars optional with sensible defaults.

| Variable | Default | Purpose |
|---|---|---|
| `DETECTOR_ENABLED` | `true` | Master kill switch |
| `DETECTOR_INTERVAL_MS` | `300000` (5 min) | Polling loop interval |
| `DETECTOR_BURST_THRESHOLD` | `3.0` | Multiplier over baseline that triggers a burst row |
| `DETECTOR_BURST_WINDOW_MIN` | `60` | Bucket window for burst detection |
| `REPO_URL` | unset | Base URL for commit links in the UI |
| `GIT_REPO_PATH` | `process.cwd()` | Working directory for `git log` |

## Error handling

- Per-detector try/catch in the scheduler — one detector's failure does not affect others
- `git` not installed or directory not a repo → unlinkedCommit and burst log a one-time warning at startup and disable themselves; scopeChange still works (DB-only)
- DB write failures bubble up from `logActivity` and are caught by the scheduler's per-detector wrapper

## Testing

- One integration test file per detector in `tests/detectors/<name>.test.ts`
- Use `createTestDb()` per test (consistent with existing test conventions)
- `gitLog()` wrapper is stubbed in tests via dependency injection (passed into detector constructor or module-level injection point)
- Tests assert: correct rows written to `activity_log`, idempotency via `detector_state`, no emission when signals don't match, baseline updates for burst
- Scheduler test: verifies one failing detector doesn't break others

## Open questions

None — all design decisions made during brainstorming.

## Out of scope (deferred)

- Manual note entry as a complement to detection
- Multi-repo / per-project git path config
- Per-project burst thresholds
- ML-based anomaly detection for bursts (statistical baseline is sufficient for v1)
- Detector dashboard / observability page (relying on stderr summary for v1)
