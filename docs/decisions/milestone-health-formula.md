# Milestone Health Formula

**Status**: Adopted
**Date**: 2026-05-03
**Scope**: M6-T1 (Audit & fix milestone-health computation)

## Context

The Executive view's milestone-health column is the primary "what's at risk?" signal in Vibe Dash. Today the heuristic lives in [server/db/analytics.ts](../../server/db/analytics.ts) `getMilestoneHealth` (lines 55–92) and produces visibly wrong answers — most notably, undated milestones at 0% progress render as **On Track**.

This decision documents the bugs in the existing logic and the replacement formula.

## Current logic

```ts
let health = "on_track";
if (m.target_date) {
  const daysLeft = (target_date - now) / 1day;
  const remaining = total - done;
  if (daysLeft < 0)            health = remaining > 0 ? "behind" : "on_track";
  else if (remaining > 0 && daysLeft < remaining * 0.5) health = "at_risk";
}
```

## Bug catalog

1. **No target_date → always "on_track"** *(primary bug)*
   The outer `if (m.target_date)` short-circuits — any milestone without a deadline reads green even at 0% progress. This is the screenshotted regression that motivated M6.

2. **`daysLeft < remaining * 0.5` is arbitrary**
   "Half a day per remaining task" has no relationship to actual completion velocity, milestone size, or elapsed time. A 100-task milestone that's 95% done with 4 days left flips to "at_risk" (4 < 5 × 0.5) even though it's clearly on pace.

3. **Past-due grace via `remaining > 0 ? "behind" : "on_track"`**
   Acceptable, but conflates "completed before deadline" with "completed after deadline" — both report `on_track`. Not a correctness bug; a clarity bug. We accept this trade-off (don't surface a fourth "completed-late" state for now).

## Replacement formula

The new heuristic compares **progress against elapsed time** — a milestone is healthy when its completion percentage keeps up with how much of its window has burned.

```ts
function computeMilestoneHealth({ progress, created_at, target_date, now }) {
  // progress is 0..1
  if (progress >= 1) return "on_track";                // done is done
  if (target_date && now > target_date) return "behind"; // overdue + incomplete
  if (!target_date) return "at_risk";                  // primary bug fix
  const elapsed = (now - created_at) / (target_date - created_at);
  const delta = progress - elapsed;                    // negative = behind schedule
  if (delta < -0.30) return "behind";
  if (delta < -0.15) return "at_risk";
  return "on_track";
}
```

### Why these thresholds

- **0.15 / 0.30** chosen as a starting point: a 15-percentage-point gap between progress and elapsed time is a noticeable lag; 30 points is "you're not going to make it without intervention." Easy to tune later from real usage.
- **No target_date → at_risk** rather than a new "undated" status, so the existing three-bucket UI keeps working. An undated milestone that *is* complete still surfaces as on_track.
- **Past-due + incomplete → behind** unconditionally, regardless of delta. Once the deadline passes, the only honest signal is "behind."

### Edge cases

| Case | Result |
|---|---|
| progress = 1, no target_date | on_track |
| progress < 1, no target_date | at_risk |
| target_date in future, progress >> elapsed | on_track |
| target_date in future, delta in [−0.30, −0.15) | at_risk |
| target_date in future, delta < −0.30 | behind |
| target_date past, progress < 1 | behind |
| target_date past, progress = 1 | on_track |

These seven cases are covered by `tests/milestone-health.test.ts` (M6-T1d).

## Non-goals

- **Velocity-based forecasting** (using completion rate over the last N days to project arrival). Worth doing later but adds complexity and depends on enough history existing — punt.
- **Configurable thresholds**. Tune from data once we have it.
- **A "completed-late" status**. Three buckets remain.

## References

- Spec: M6-T1 / M6-T1a / M6-T1b in vibe-dash
- Existing helper: [server/db/analytics.ts](../../server/db/analytics.ts):55–92
- ExecutiveSummary consumer: [src/components/ExecutiveView.tsx](../../src/components/ExecutiveView.tsx)
