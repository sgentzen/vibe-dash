# OTLP Series Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a local process growing `otlp_series` without bound, without ever deleting a row.

**Architecture:** `seriesIncrement` refuses to CREATE a new series once the table holds `SERIES_CAP` rows, returning `null`. Existing series are unaffected at any table size, and delta points never reach the function at all. A refused point is counted and surfaced on the ingest status endpoint, because a refusal is spend we could not record.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions), better-sqlite3 with raw SQL, Vitest integration tests against a real in-memory database.

## Global Constraints

Copied from the spec and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-11-otlp-series-cap-design.md`. Read it before Task 1.
- **No ORM.** Raw SQL with better-sqlite3 prepared statements.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Imports:** ESM with explicit `.js` extensions on relative imports.
- **Naming:** PascalCase types, camelCase functions, snake_case DB columns and tables.
- **Tests** live in `tests/`, named `*.test.ts`, get a fresh in-memory DB via `createTestDb()` from `./setup.js` in a `beforeEach`, and are integration style against a real database with no mocking.
- **Style:** Australian English in prose and documents. No em-dashes there, no emojis anywhere. Code comments follow the surrounding repository convention, which does use em-dashes.
- **Nothing is ever deleted from `otlp_series`.** That is the decision this plan implements, not an incidental detail. See D1.
- **A refused point is lost spend** and must be counted, never silent.
- **The gate before any completing commit** is the `finish-task` skill.

### The one thing most likely to go wrong

`null <= 0` evaluates to `true` in JavaScript, because `null` coerces to `0`. The existing caller reads `if (quantity <= 0) continue`, so a `null` return would be swallowed by that guard and behave correctly by accident, while counting nothing and telling nobody. Task 1 makes the check explicit. If the refused counter ever reads zero under a flood, this is why.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/ingest/otlp/series.ts` (modify) | `SERIES_CAP`, the refusal, and the `number \| null` return |
| `server/ingest/otlp/ingest.ts` (modify) | Distinguish a refusal from a zero increment, and count it |
| `server/ingest/transcripts/sync.ts` (modify) | `otlpSeriesCount` and `otlpSeriesRefused` on the ingest status |
| `tests/otlp-series-cap.test.ts` (create) | The cap, and that existing series survive it |
| `tests/otlp-route.test.ts` (modify) | The two new status fields |
| `docs/ingestion.md` (modify) | What the cap is and what a refusal means |

---

### Task 1: The cap, the refusal, and the caller

**Files:**
- Modify: `server/ingest/otlp/series.ts`
- Modify: `server/ingest/otlp/ingest.ts`
- Test: `tests/otlp-series-cap.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const SERIES_CAP = 10_000`
  - `seriesIncrement(...)` returns `number | null`; `null` means refused.
  - `export function refusedSeriesPointCount(): number` from `ingest.ts`.
  - `ingestMetricsPayload`'s result gains `refused: number`.

**Why one task.** The signature change forces the caller change: split across two tasks the tree would be red in between, and the second task's test gate could not tell new breakage from old.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-series-cap.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { seriesIncrement, SERIES_CAP } from "../server/ingest/otlp/series.js";
import { ingestMetricsPayload, refusedSeriesPointCount } from "../server/ingest/otlp/ingest.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

/**
 * Fill otlp_series to `rows` entries in one statement.
 *
 * A recursive CTE rather than ten thousand round trips: the point of these
 * tests is the behaviour at the boundary, not how long it takes to reach it.
 */
function fillSeries(db: Database.Database, rows: number): void {
  db.prepare(
    `WITH RECURSIVE counter(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < ?
     )
     INSERT INTO otlp_series (series_key, start_time_nano, last_value, last_time_unix_nano, updated_at)
     SELECT 'filler-' || x, '1000', 0, '1000', '2026-08-11T00:00:00.000Z' FROM counter`
  ).run(rows);
}

function seriesCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM otlp_series").get() as { n: number }).n;
}

describe("the series cap", () => {
  it("creates a new series while the table is under the cap", () => {
    expect(seriesIncrement(db, "fresh", "1000", "2000", 100)).toBe(100);
  });

  it("refuses a NEW series once the table is full, returning null not zero", () => {
    // null and 0 mean different things and must not be conflated: null is
    // spend we could not record, 0 is a series that has not moved.
    fillSeries(db, SERIES_CAP);
    expect(seriesIncrement(db, "one-too-many", "1000", "2000", 100)).toBeNull();
  });

  it("writes no row when it refuses, so the cap actually holds", () => {
    fillSeries(db, SERIES_CAP);
    seriesIncrement(db, "one-too-many", "1000", "2000", 100);
    expect(seriesCount(db)).toBe(SERIES_CAP);
  });

  it("KEEPS RECORDING an existing series at the cap", () => {
    // The property that makes this design safe rather than merely bounded. An
    // established sender must be unaffected by how full the table is, because
    // the alternative is losing its spend for someone else's flood.
    seriesIncrement(db, "established", "1000", "2000", 100);
    fillSeries(db, SERIES_CAP);

    expect(seriesIncrement(db, "established", "1000", "3000", 150)).toBe(50);
  });

  it("still refuses after the table is over the cap", () => {
    fillSeries(db, SERIES_CAP + 50);
    expect(seriesIncrement(db, "another", "1000", "2000", 100)).toBeNull();
  });

  it("creates the very last series at exactly one below the cap", () => {
    // Boundary: create when count < SERIES_CAP, refuse when count >= SERIES_CAP.
    fillSeries(db, SERIES_CAP - 1);
    expect(seriesIncrement(db, "the-last-one", "1000", "2000", 100)).toBe(100);
    expect(seriesCount(db)).toBe(SERIES_CAP);
  });
});

describe("a refused point through the pipeline", () => {
  function cumulativePayload(key: string, sum: number): unknown {
    return {
      resourceMetrics: [{
        resource: { attributes: [{ key: "nonce", value: { stringValue: key } }] },
        scopeMetrics: [{ scope: { name: "codex" }, metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5.3-codex" } },
              ],
              startTimeUnixNano: "1000", timeUnixNano: "2000", count: "1", sum,
            }],
          },
        }] }],
      }],
    };
  }

  it("writes no cost row and is counted as refused", () => {
    fillSeries(db, SERIES_CAP);
    const before = refusedSeriesPointCount();

    const result = ingestMetricsPayload(db, cumulativePayload("a", 500));

    expect(result.recorded).toBe(0);
    expect(result.refused).toBe(1);
    expect(refusedSeriesPointCount()).toBe(before + 1);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM cost_entries").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("does not count an unmoved existing series as refused", () => {
    // The coercion trap in reverse: a series that has not moved returns 0, not
    // null, and must not inflate the refused count.
    ingestMetricsPayload(db, cumulativePayload("b", 500));
    const before = refusedSeriesPointCount();

    const result = ingestMetricsPayload(db, cumulativePayload("b", 500));

    expect(result.refused).toBe(0);
    expect(refusedSeriesPointCount()).toBe(before);
  });

  it("leaves a DELTA point unaffected at the cap", () => {
    // Delta points never call seriesIncrement, so the cap cannot reach them.
    fillSeries(db, SERIES_CAP);
    const payload = cumulativePayload("c", 500) as {
      resourceMetrics: { scopeMetrics: { metrics: { histogram: { aggregationTemporality: string } }[] }[] }[];
    };
    payload.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.aggregationTemporality =
      "AGGREGATION_TEMPORALITY_DELTA";

    const result = ingestMetricsPayload(db, payload);

    expect(result.recorded).toBe(1);
    expect(result.refused).toBe(0);
  });
});
```

Note the module-level `refusedSeriesPointCount()` is process-lifetime, so these tests read it as a DELTA from a captured baseline rather than asserting an absolute value. Vitest isolates per file, but within a file the counter accumulates.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-series-cap.test.ts`
Expected: FAIL. `SERIES_CAP` and `refusedSeriesPointCount` are not exported, and `result.refused` does not exist.

- [ ] **Step 3: Add the cap to `seriesIncrement`**

In `server/ingest/otlp/series.ts`, add near the top:

```ts
/**
 * How many distinct series this table will hold.
 *
 * A legitimate sender converges on a handful: Codex emits four token types
 * across a model or two, so a real install reaches perhaps a dozen rows and
 * never grows again. Ten thousand distinct attribute combinations is not a
 * configuration, it is a flood.
 *
 * The bound holds against the traffic the endpoint permits. A 1mb body carries
 * roughly 5,000 points, so at the route's 120 requests per minute a flooder
 * reaches this ceiling within seconds, after which every new key is refused
 * and the table stops growing.
 *
 * Deliberately a constant rather than a setting: nothing indicates a real user
 * anywhere near it, and a knob invites tuning a number nobody should have to
 * think about. It can become a setting the first time someone hits it in anger.
 */
export const SERIES_CAP = 10_000;
```

Then change the signature's return type to `number | null` and insert the check on the create branch only:

```ts
  const previous = db
    .prepare("SELECT start_time_nano, last_value, last_time_unix_nano FROM otlp_series WHERE series_key = ?")
    .get(key) as { start_time_nano: string; last_value: number; last_time_unix_nano: string } | undefined;

  if (previous !== undefined && !isStrictlyNewer(timeUnixNano, previous.last_time_unix_nano)) {
    return 0;
  }

  // Only a NEW series consults the cap, so an established sender never pays
  // for this count and is never refused however full the table is. That is the
  // whole point: nothing is ever deleted, so a live series cannot be mistaken
  // for a new one, and a flood cannot cost a legitimate sender its spend.
  if (previous === undefined) {
    const { n } = db.prepare("SELECT COUNT(*) AS n FROM otlp_series").get() as { n: number };
    if (n >= SERIES_CAP) return null;
  }
```

Update the function's doc comment to state that `null` means refused and is distinct from `0`.

- [ ] **Step 4: Make the caller distinguish a refusal from a zero**

In `server/ingest/otlp/ingest.ts`, add the counter beside the existing one, following its comment style:

```ts
// Process-lifetime for the same reason unmappedPoints is: a refused point
// writes no row, so there is no table to count it from afterwards. Resets on
// restart, which is a weaker guarantee than the query-backed counters and is
// stated here rather than left to be discovered.
let refusedSeriesPoints = 0;

/** Read the process-lifetime count of points refused because the series cap was reached. */
export function refusedSeriesPointCount(): number {
  return refusedSeriesPoints;
}
```

Change `resolveQuantity`'s return type to `number | null` (it simply passes `seriesIncrement`'s result through for cumulative points, and still returns `point.value` for delta ones).

Then, at the call site, replace:

```ts
    const quantity = resolveQuantity(db, point);
    if (quantity <= 0) continue;
```

with:

```ts
    // `null` is checked BEFORE the <= 0 guard and with ===, because
    // `null <= 0` is true in JavaScript: null coerces to 0. Written the other
    // way round, a refusal would be silently swallowed by the numeric guard,
    // behave correctly by accident, and never reach the counter that exists to
    // make it visible.
    const quantity = resolveQuantity(db, point);
    if (quantity === null) {
      refusedSeriesPoints++;
      refused++;
      continue;
    }
    if (quantity <= 0) continue;
```

Add `refused` to the local tally and to `ingestMetricsPayload`'s return type and returned object, beside `recorded`, `unmapped` and `unattributed`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-series-cap.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS, and lint at 0 problems. Existing OTLP tests must be unaffected: no test fills the table, so no existing path reaches the cap.

- [ ] **Step 7: Commit**

```bash
git add server/ingest/otlp/series.ts server/ingest/otlp/ingest.ts tests/otlp-series-cap.test.ts
git commit -m "feat(otlp): cap how many series the table will hold"
```

---

### Task 2: Surface the cap on the ingest status

**Files:**
- Modify: `server/ingest/transcripts/sync.ts` (`getIngestStatus`)
- Test: `tests/otlp-route.test.ts` (extend)

**Interfaces:**
- Consumes: `refusedSeriesPointCount` from Task 1.
- Produces: `otlpSeriesCount` and `otlpSeriesRefused` on the status payload.

**Why this is not optional.** A refused point is spend that could not be recorded. Without these fields a flooded install under-reports a legitimate sender and nothing anywhere says so, which is the failure this project treats as equal to double counting.

- [ ] **Step 1: Write the failing test**

Append to `tests/otlp-route.test.ts`:

The existing `codexPayload` helper in that file sends a DELTA point. I checked.
Delta points never create a series row, so reusing it here would leave
`otlpSeriesCount` at zero and the test would fail for a reason that has nothing
to do with the code under test. Add a local cumulative variant rather than
changing the shared helper, which the file's other tests depend on:

```ts
function cumulativeCodexPayload(input: number): unknown {
  const payload = codexPayload(input) as {
    resourceMetrics: { scopeMetrics: { metrics: { histogram: { aggregationTemporality: string } }[] }[] }[];
  };
  payload.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.aggregationTemporality =
    "AGGREGATION_TEMPORALITY_CUMULATIVE";
  return payload;
}

describe("the ingest status reports the series cap", () => {
  it("counts the rows actually in otlp_series", async () => {
    await requestApp(app, "POST", "/v1/metrics", cumulativeCodexPayload(100));

    // Cumulative, so this creates a series row. A real query rather than a
    // process counter: it must survive anything but a change to the table.
    expect(getIngestStatus(db).otlpSeriesCount).toBeGreaterThan(0);
  });

  it("reports zero series on an untouched database", () => {
    expect(getIngestStatus(db).otlpSeriesCount).toBe(0);
  });

  it("exposes the refused count", () => {
    // Process-lifetime, so this asserts the field exists and is a number
    // rather than a value another test in this file may have moved.
    expect(typeof getIngestStatus(db).otlpSeriesRefused).toBe("number");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-route.test.ts`
Expected: FAIL. Both fields are undefined.

- [ ] **Step 3: Add the fields**

In `server/ingest/transcripts/sync.ts`, extend `getIngestStatus`'s return type and body, beside the existing OTLP counters:

```ts
    otlpSeriesCount: one(`SELECT COUNT(*) AS n FROM otlp_series`),
    // Process-lifetime, not a query — see refusedSeriesPointCount's own
    // comment. A refused point writes no row, so nothing survives to count.
    otlpSeriesRefused: refusedSeriesPointCount(),
```

Import `refusedSeriesPointCount` from `../otlp/ingest.js`, extending the existing import of `unmappedPointCount` rather than adding a second line.

- [ ] **Step 4: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. `tests/ingest-routes.test.ts` asserts status keys with `toMatchObject`, so added keys must not break it.

```bash
git add server/ingest/transcripts/sync.ts tests/otlp-route.test.ts
git commit -m "feat(otlp): report the series count and how many points the cap refused"
```

---

### Task 3: Documentation

No code. The two previous features in this area both shipped documentation that overstated what the code did. Verify every claim against the code rather than transcribing it from this plan.

**Files:**
- Modify: `docs/ingestion.md`

- [ ] **Step 1: Document the cap in the OTLP section**

Add to the OTLP section of `docs/ingestion.md`, in the same plain style as the limits already there:

- Vibe Dash holds at most `SERIES_CAP` distinct metric series. State the number.
- Once full, a point belonging to a series it has never seen is skipped and counted in `otlpSeriesRefused`. Its tokens are not recorded.
- A series it already knows keeps recording normally, however full the table is. Say this explicitly: it is the reassurance that matters to somebody reading after a flood.
- Nothing is ever deleted from the table, so no sender can have its running total re-recorded as new spend.
- `otlpSeriesCount` on `GET /api/ingest/status` shows how close an install is.

State plainly that `otlpSeriesRefused` resets when the server restarts, as the existing text does for the unmapped count.

- [ ] **Step 2: Verify each claim**

Read `server/ingest/otlp/series.ts` and confirm: the cap value, that the check is on the create branch only, that nothing deletes, and that delta points never reach it. Correct the prose if any claim does not hold, and say in your report which one.

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS.

```bash
git add docs/ingestion.md
git commit -m "docs: explain the OTLP series cap and what a refused point means"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm the spec's four success criteria:

1. A process posting unique attribute values cannot grow `otlp_series` past the cap.
2. With the table at the cap, an established cumulative sender's figures are unchanged. The Task 1 test "KEEPS RECORDING an existing series at the cap" is the proof; re-read it and confirm it would fail if the cap were checked before the existence lookup rather than after.
3. A refused point appears in `otlpSeriesRefused` and nowhere in `cost_entries`.
4. No cumulative series ever loses its stored state. Confirm by grep that no `DELETE FROM otlp_series` exists anywhere in the repository.
