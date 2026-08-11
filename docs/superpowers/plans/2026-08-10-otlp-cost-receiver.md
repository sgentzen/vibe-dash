# OTLP Cost Receiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept OTLP metrics from coding agents other than Claude Code, so their token spend reaches the same tables without the agent calling `log_cost`.

**Architecture:** One JSON endpoint, `POST /v1/metrics`, on the existing Express server. A generic reader normalises OTLP points and resolves delta versus cumulative temporality against a stored series state. A per-runner mapper turns recognised metric names into token counts. The first mapper is Codex. Claude Code is deliberately not mapped and its points are counted as unmapped.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions), better-sqlite3 with raw SQL, Express 5 route factories, Vitest integration tests against a real in-memory database.

## Global Constraints

Copied from the spec and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-10-otlp-cost-receiver-design.md`. Read it before Task 1.
- **No ORM.** Raw SQL with better-sqlite3 prepared statements.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Timestamps** are ISO 8601 strings via `new Date().toISOString()`.
- **Imports:** ESM with explicit `.js` extensions on relative imports.
- **Naming:** PascalCase types, camelCase functions, snake_case DB columns and tables.
- **Error responses** are `{ error: "message" }` with an appropriate status, EXCEPT the OTLP endpoint, which must follow the OTLP/HTTP contract in Task 6 because exporters act on its status codes.
- **Tests** live in `tests/`, named `*.test.ts`, get a fresh in-memory DB via `createTestDb()` from `./setup.js` in a `beforeEach`, and are integration style against a real database with no mocking. The HTTP helper is `requestApp(app, method, path, body)` returning `{ status, body }`; it is not supertest.
- **Style:** Australian English in prose and documents. No em-dashes there, no emojis anywhere. Code comments follow the surrounding repository convention, which does use em-dashes.
- **Never guess.** An unknown model stores `cost_usd NULL`, never 0. A point naming no project stores `project_id NULL`. A metric we do not recognise is counted, not silently dropped.
- **Never invent a price.** See Task 4. A rate you cannot cite does not go in the table.
- **No cost row is ever deleted.**
- **The gate before any completing commit** is the `finish-task` skill.

### The one thing most likely to go wrong

Treating a cumulative point as delta multiplies reported spend by the number of exports, and nothing fails while it happens. Task 2 owns that logic and Task 2's tests are the ones that matter most in this plan.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/migrator.ts` (modify) | Migration `022_otlp_series` |
| `server/ingest/otlp/series.ts` (create) | Series state: turn a cumulative value into an increment |
| `server/ingest/otlp/types.ts` (create) | `OtlpPoint`, `MappedUsage`, shared shapes |
| `server/ingest/otlp/parse.ts` (create) | Walk an OTLP/JSON payload into normalised points |
| `server/ingest/otlp/mappers/codex.ts` (create) | `codex.turn.token_usage` to token counts |
| `server/ingest/otlp/mappers/index.ts` (create) | Mapper registry, so adding a runner is one file |
| `server/ingest/otlp/attribute.ts` (create) | Resolve `vibe_dash.project` to a project id |
| `server/ingest/otlp/ingest.ts` (create) | Compose: points to increments to priced rows |
| `server/ingest/transcripts/pricing.ts` (modify) | Extract `priceTokens`, add non-Anthropic rates |
| `server/routes/otlp.ts` (create) | `POST /v1/metrics` and the OTLP response contract |
| `server/routes/index.ts` (modify) | Register the route factory |
| `server/index.ts` (modify) | Mount the OTLP body parser ahead of the global one |
| `server/ingest/transcripts/sync.ts` (modify) | `otlpUnmapped` and `otlpUnattributed` on the status |
| `tests/otlp-series.test.ts` (create) | Temporality and reset behaviour |
| `tests/otlp-parse.test.ts` (create) | Payload walking and encoding quirks |
| `tests/otlp-codex-mapper.test.ts` (create) | The Codex mapping, including the `total` trap |
| `tests/otlp-pricing.test.ts` (create) | `priceTokens` and unknown-model behaviour |
| `tests/otlp-route.test.ts` (create) | End to end through the endpoint |

---

### Task 1: Migration 022 and the series state store

**Files:**
- Modify: `server/db/migrator.ts` (append to `MIGRATIONS`, after `021_agent_cost_observed`)
- Create: `server/ingest/otlp/series.ts`
- Test: `tests/otlp-series.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Table `otlp_series(series_key TEXT PRIMARY KEY NOT NULL, start_time_nano TEXT NOT NULL, last_value REAL NOT NULL, updated_at TEXT NOT NULL)`
  - `function seriesIncrement(db, key: string, startTimeNano: string, value: number): number`

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-series.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { seriesIncrement } from "../server/ingest/otlp/series.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const KEY = "series-a";
const START = "1000";

describe("seriesIncrement", () => {
  it("returns the whole value the first time a series is seen", () => {
    expect(seriesIncrement(db, KEY, START, 100)).toBe(100);
  });

  it("returns only the increase on subsequent points", () => {
    // The heart of the feature. A cumulative sender re-sends a running total on
    // every export; recording the value rather than the increase multiplies
    // reported spend by the number of exports, silently.
    expect(seriesIncrement(db, KEY, START, 100)).toBe(100);
    expect(seriesIncrement(db, KEY, START, 250)).toBe(150);
    expect(seriesIncrement(db, KEY, START, 260)).toBe(10);
  });

  it("returns zero when the value has not moved", () => {
    seriesIncrement(db, KEY, START, 100);
    expect(seriesIncrement(db, KEY, START, 100)).toBe(0);
  });

  it("treats a new start time as a restart and takes the full value", () => {
    // A process restart begins a new series at zero. Subtracting against the
    // old high-water mark would report negative spend.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, "2000", 20)).toBe(20);
  });

  it("treats a value going backwards as a restart, not a negative delta", () => {
    // Some senders reuse a start time across a restart. A decrease is the only
    // remaining signal, and spend already incurred must never be subtracted.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, START, 30)).toBe(30);
  });

  it("keeps series independent", () => {
    seriesIncrement(db, "a", START, 100);
    expect(seriesIncrement(db, "b", START, 7)).toBe(7);
    expect(seriesIncrement(db, "a", START, 130)).toBe(30);
  });

  it("stores the latest value and start time, not the first", () => {
    seriesIncrement(db, KEY, START, 100);
    seriesIncrement(db, KEY, "2000", 40);
    const row = db.prepare("SELECT start_time_nano, last_value FROM otlp_series WHERE series_key = ?").get(KEY) as
      { start_time_nano: string; last_value: number };
    expect(row.start_time_nano).toBe("2000");
    expect(row.last_value).toBe(40);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-series.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Add the migration**

Append to the `MIGRATIONS` array in `server/db/migrator.ts`, after `021_agent_cost_observed`:

```ts
  {
    name: "022_otlp_series",
    run(db) {
      // Remembers the last value seen for each cumulative OTLP metric series,
      // so an export carrying a running total contributes only its increase.
      //
      // Same purpose as transcript_files: a record of what has already been
      // counted, so re-reading a source does not recount it. Without it, a
      // cumulative sender's spend is multiplied by the number of exports and
      // nothing fails to make that visible.
      //
      // start_time_nano is stored rather than folded into the key: it is what
      // identifies a restart, and a restart must take the full new value
      // instead of subtracting against a high-water mark that no longer exists.
      db.exec(`
        CREATE TABLE IF NOT EXISTS otlp_series (
          series_key      TEXT PRIMARY KEY NOT NULL,
          start_time_nano TEXT NOT NULL,
          last_value      REAL NOT NULL,
          updated_at      TEXT NOT NULL
        )
      `);
    },
  },
```

- [ ] **Step 4: Implement the series store**

Create `server/ingest/otlp/series.ts`:

```ts
import type Database from "better-sqlite3";

/**
 * How much of a cumulative metric value is new since the last point.
 *
 * Call this only for cumulative points. A delta point already describes an
 * interval and must be recorded as-is; passing one here would treat successive
 * intervals as a running total and understate everything after the first.
 *
 * Returns the full value for a series we have not seen, and for a restart. A
 * restart is a new start time, or a value below the one we stored: spend
 * already incurred is never subtracted, so a decrease is read as "the counter
 * went back to zero and has climbed to here again".
 */
export function seriesIncrement(
  db: Database.Database,
  key: string,
  startTimeNano: string,
  value: number
): number {
  const previous = db
    .prepare("SELECT start_time_nano, last_value FROM otlp_series WHERE series_key = ?")
    .get(key) as { start_time_nano: string; last_value: number } | undefined;

  const restarted =
    previous === undefined ||
    previous.start_time_nano !== startTimeNano ||
    value < previous.last_value;

  const increment = restarted ? value : value - previous.last_value;

  db.prepare(
    `INSERT INTO otlp_series (series_key, start_time_nano, last_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(series_key) DO UPDATE SET
       start_time_nano = excluded.start_time_nano,
       last_value      = excluded.last_value,
       updated_at      = excluded.updated_at`
  ).run(key, startTimeNano, value, new Date().toISOString());

  return increment;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-series.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/db/migrator.ts server/ingest/otlp/series.ts tests/otlp-series.test.ts
git commit -m "feat(otlp): remember cumulative series state so exports are not recounted"
```

---

### Task 2: The OTLP payload reader

**Files:**
- Create: `server/ingest/otlp/types.ts`
- Create: `server/ingest/otlp/parse.ts`
- Test: `tests/otlp-parse.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface OtlpPoint { metricName: string; resourceAttributes: Record<string, string>; scopeName: string; attributes: Record<string, string>; timeUnixNano: string; startTimeUnixNano: string; value: number; cumulative: boolean; }`
  - `function parseMetricsPayload(body: unknown): OtlpPoint[]`

**Encoding facts this task must handle.** OTLP/JSON follows the protobuf JSON mapping, which means:
- 64-bit integers are encoded as **strings**: `"timeUnixNano": "1699999999000000000"`.
- Enums may appear as the **name or the number**: `aggregationTemporality` is either `"AGGREGATION_TEMPORALITY_DELTA"` or `1`, and cumulative is `"AGGREGATION_TEMPORALITY_CUMULATIVE"` or `2`.
- A Sum point's value is `asDouble` (number) or `asInt` (string). A Histogram point's value is `sum` (number, optional).
- Attribute values are wrapped: `{"key": "model", "value": {"stringValue": "gpt-5-codex"}}`.

Both shapes are accepted because a Claude Code exporter sends Sums, and success criterion 4 requires those points to be visibly counted as unmapped rather than invisibly skipped.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseMetricsPayload } from "../server/ingest/otlp/parse.js";

function histogramPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "codex" } }] },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5-codex" } },
              ],
              startTimeUnixNano: "1000",
              timeUnixNano: "2000",
              count: "3",
              sum: 1500,
              ...overrides,
            }],
          },
        }],
      }],
    }],
  };
}

describe("parseMetricsPayload", () => {
  it("reads a histogram point's sum, not its count", () => {
    // count is the number of turns recorded, sum is the tokens.
    const [point] = parseMetricsPayload(histogramPayload());
    expect(point.value).toBe(1500);
    expect(point.metricName).toBe("codex.turn.token_usage");
  });

  it("flattens attributes and resource attributes", () => {
    const [point] = parseMetricsPayload(histogramPayload());
    expect(point.attributes).toEqual({ token_type: "input", model: "gpt-5-codex" });
    expect(point.resourceAttributes).toEqual({ "service.name": "codex" });
  });

  it("reads temporality given as an enum name", () => {
    expect(parseMetricsPayload(histogramPayload())[0].cumulative).toBe(false);
  });

  it("reads temporality given as an enum number", () => {
    // The protobuf JSON mapping permits either form, and exporters differ.
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "m",
          histogram: {
            aggregationTemporality: 2,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", sum: 5 }],
          },
        }] }],
      }],
    };
    expect(parseMetricsPayload(payload)[0].cumulative).toBe(true);
  });

  it("reads a Sum point given asInt, which arrives as a string", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "claude_code.token.usage",
          sum: {
            aggregationTemporality: 1,
            isMonotonic: true,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", asInt: "42" }],
          },
        }] }],
      }],
    };
    const [point] = parseMetricsPayload(payload);
    expect(point.value).toBe(42);
    expect(point.metricName).toBe("claude_code.token.usage");
  });

  it("skips a histogram point with no sum rather than treating it as zero", () => {
    const payload = histogramPayload();
    // Remove the sum field entirely.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (payload as any).resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0].sum;
    expect(parseMetricsPayload(payload)).toEqual([]);
  });

  it("returns an empty list for a payload with no metrics", () => {
    expect(parseMetricsPayload({ resourceMetrics: [] })).toEqual([]);
    expect(parseMetricsPayload({})).toEqual([]);
  });

  it("throws on a body that is not an object", () => {
    expect(() => parseMetricsPayload(null)).toThrow();
    expect(() => parseMetricsPayload("nope")).toThrow();
  });

  it("ignores gauge and other metric types it does not read", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "s" }, metrics: [{
          name: "some.gauge",
          gauge: { dataPoints: [{ attributes: [], timeUnixNano: "2", asDouble: 3 }] },
        }] }],
      }],
    };
    expect(parseMetricsPayload(payload)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-parse.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Define the shared types**

Create `server/ingest/otlp/types.ts`:

```ts
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
```

- [ ] **Step 4: Implement the reader**

Create `server/ingest/otlp/parse.ts`:

```ts
import type { OtlpPoint } from "./types.js";

/**
 * Flatten OTLP's wrapped attribute list into a plain record.
 *
 * Only string values are kept. Token counts and model names are strings in
 * practice, and a partial record is safer than coercing an unexpected type
 * into one.
 */
function flattenAttributes(raw: unknown): Record<string, string> {
  if (!Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const key = (entry as { key?: unknown }).key;
    const value = (entry as { value?: { stringValue?: unknown } }).value?.stringValue;
    if (typeof key === "string" && typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Whether an aggregationTemporality field means cumulative.
 *
 * The protobuf JSON mapping allows an enum as its name or its number, and
 * exporters genuinely differ, so both are read. Anything unrecognised is
 * treated as delta, which is the OTLP default for a field left unset.
 */
function isCumulative(raw: unknown): boolean {
  return raw === 2 || raw === "AGGREGATION_TEMPORALITY_CUMULATIVE";
}

/** 64-bit ints arrive as strings under the protobuf JSON mapping. */
function asNumber(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Walk an OTLP/JSON ExportMetricsServiceRequest into flat points.
 *
 * Sums and histograms are both read. Histograms are what Codex sends; Sums are
 * what Claude Code sends, and although no mapper consumes them, they must be
 * parsed so those points can be COUNTED as unmapped rather than vanishing.
 * Silently ignoring a runner's data looks identical to it sending none.
 *
 * Throws only for a body that is not an object. A structurally odd but
 * object-shaped payload yields the points it can and skips the rest.
 */
export function parseMetricsPayload(body: unknown): OtlpPoint[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("OTLP payload must be a JSON object");
  }

  const points: OtlpPoint[] = [];
  const resourceMetrics = (body as { resourceMetrics?: unknown }).resourceMetrics;
  if (!Array.isArray(resourceMetrics)) return points;

  for (const rm of resourceMetrics) {
    const resourceAttributes = flattenAttributes(
      (rm as { resource?: { attributes?: unknown } }).resource?.attributes
    );
    const scopeMetrics = (rm as { scopeMetrics?: unknown }).scopeMetrics;
    if (!Array.isArray(scopeMetrics)) continue;

    for (const sm of scopeMetrics) {
      const scopeName = String((sm as { scope?: { name?: unknown } }).scope?.name ?? "");
      const metrics = (sm as { metrics?: unknown }).metrics;
      if (!Array.isArray(metrics)) continue;

      for (const metric of metrics) {
        const metricName = (metric as { name?: unknown }).name;
        if (typeof metricName !== "string") continue;

        const histogram = (metric as { histogram?: { aggregationTemporality?: unknown; dataPoints?: unknown } }).histogram;
        const sum = (metric as { sum?: { aggregationTemporality?: unknown; dataPoints?: unknown } }).sum;
        const container = histogram ?? sum;
        if (!container || !Array.isArray(container.dataPoints)) continue;

        const cumulative = isCumulative(container.aggregationTemporality);

        for (const dp of container.dataPoints) {
          const point = dp as Record<string, unknown>;
          // A histogram carries its total in `sum`; a Sum point carries it in
          // asDouble or asInt. `count` is the number of recorded observations,
          // never the quantity, so it is deliberately not a fallback here.
          const value = histogram
            ? asNumber(point.sum)
            : asNumber(point.asDouble) ?? asNumber(point.asInt);
          if (value === null) continue;

          const timeUnixNano = String(point.timeUnixNano ?? "");
          if (timeUnixNano === "") continue;

          points.push({
            metricName,
            resourceAttributes,
            scopeName,
            attributes: flattenAttributes(point.attributes),
            timeUnixNano,
            startTimeUnixNano: String(point.startTimeUnixNano ?? timeUnixNano),
            value,
            cumulative,
          });
        }
      }
    }
  }

  return points;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-parse.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/ingest/otlp/types.ts server/ingest/otlp/parse.ts tests/otlp-parse.test.ts
git commit -m "feat(otlp): read OTLP/JSON metric points, including their temporality"
```

---

### Task 3: The Codex mapper and the registry

**Files:**
- Create: `server/ingest/otlp/mappers/codex.ts`
- Create: `server/ingest/otlp/mappers/index.ts`
- Test: `tests/otlp-codex-mapper.test.ts` (create)

**Interfaces:**
- Consumes: `OtlpPoint` and `MappedUsage` from Task 2.
- Produces:
  - `function mapPoint(point: OtlpPoint): MappedUsage | null` from `mappers/index.js`, returning null when no mapper recognises the metric.

**The trap this task exists to avoid.** `codex.turn.token_usage` carries a `token_type` of `total` **alongside** the components. Recording `total` as well as `input`, `output`, `cached_input` and `reasoning_output` doubles every Codex figure. It gets its own test.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-codex-mapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapPoint } from "../server/ingest/otlp/mappers/index.js";
import type { OtlpPoint } from "../server/ingest/otlp/types.js";

function point(attributes: Record<string, string>, metricName = "codex.turn.token_usage"): OtlpPoint {
  return {
    metricName,
    resourceAttributes: {},
    scopeName: "codex",
    attributes,
    timeUnixNano: "2000",
    startTimeUnixNano: "1000",
    value: 100,
    cumulative: false,
  };
}

describe("the Codex mapper", () => {
  it("maps input tokens", () => {
    expect(mapPoint(point({ token_type: "input", model: "gpt-5-codex" })))
      .toEqual({ model: "gpt-5-codex", kind: "input" });
  });

  it("maps output tokens", () => {
    expect(mapPoint(point({ token_type: "output", model: "gpt-5-codex" })))
      .toEqual({ model: "gpt-5-codex", kind: "output" });
  });

  it("maps cached input to cache reads", () => {
    expect(mapPoint(point({ token_type: "cached_input", model: "gpt-5-codex" })))
      .toEqual({ model: "gpt-5-codex", kind: "cacheRead" });
  });

  it("bills reasoning output as output", () => {
    // A pricing judgement, not a name coincidence: reasoning tokens are billed
    // at the output rate.
    expect(mapPoint(point({ token_type: "reasoning_output", model: "gpt-5-codex" })))
      .toEqual({ model: "gpt-5-codex", kind: "output" });
  });

  it("SKIPS the total, which would otherwise double every figure", () => {
    // token_type=total is the sum of the other buckets and arrives beside them.
    expect(mapPoint(point({ token_type: "total", model: "gpt-5-codex" }))).toBeNull();
  });

  it("skips a point with no model, rather than inventing one", () => {
    expect(mapPoint(point({ token_type: "input" }))).toBeNull();
  });

  it("skips a token_type it does not recognise", () => {
    expect(mapPoint(point({ token_type: "something_new", model: "gpt-5-codex" }))).toBeNull();
  });

  it("does not map Claude Code metrics, by design", () => {
    // Claude Code is covered by transcript ingestion. Mapping it here would
    // create a third source competing for the same spend.
    expect(mapPoint(point({ type: "input", model: "claude-opus-5" }, "claude_code.token.usage"))).toBeNull();
  });

  it("does not map an unrelated metric", () => {
    expect(mapPoint(point({}, "codex.tool.call"))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-codex-mapper.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Implement the Codex mapper**

Create `server/ingest/otlp/mappers/codex.ts`:

```ts
import type { MappedUsage, OtlpPoint } from "../types.js";

const METRIC = "codex.turn.token_usage";

/**
 * Codex reports each turn's tokens split by `token_type`.
 *
 * `total` is deliberately absent from this table. It arrives ALONGSIDE the
 * components rather than instead of them, so counting it as well would double
 * every Codex figure.
 *
 * `reasoning_output` maps to output because that is how it is billed, not
 * because of the name. `cached_input` maps to cache reads, which are priced at
 * a fraction of the input rate.
 */
const TOKEN_KINDS: Record<string, MappedUsage["kind"]> = {
  input: "input",
  output: "output",
  cached_input: "cacheRead",
  reasoning_output: "output",
};

/** Recognise a Codex token-usage point, or return null to leave it unmapped. */
export function mapCodexPoint(point: OtlpPoint): MappedUsage | null {
  if (point.metricName !== METRIC) return null;

  const kind = TOKEN_KINDS[point.attributes.token_type ?? ""];
  if (!kind) return null;

  // No model means no rate, and guessing one would put a wrong number in the
  // money path. Leaving it unmapped keeps it visible in the unmapped count.
  const model = point.attributes.model;
  if (!model) return null;

  return { model, kind };
}
```

Create `server/ingest/otlp/mappers/index.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-codex-mapper.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/ingest/otlp/mappers/ tests/otlp-codex-mapper.test.ts
git commit -m "feat(otlp): map Codex token usage, skipping the total that would double it"
```

---

### Task 4: Pricing for token counts, and non-Anthropic rates

**Files:**
- Modify: `server/ingest/transcripts/pricing.ts`
- Test: `tests/otlp-pricing.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface TokenCounts { model: string; speed?: string | null; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreation5mTokens: number; cacheCreation1hTokens: number; }`
  - `function priceTokens(counts: TokenCounts): number | null`
  - `priceRecord` keeps its signature and delegates to `priceTokens`.

**Why the extraction.** `priceRecord` takes a `UsageRecord`, which is transcript-shaped and carries a uuid, a session id and a cwd. An OTLP point has none of those, and faking them to reach the pricing arithmetic would be the sort of shim that later reads as a real dependency. The arithmetic already operates only on the token counts, so it moves out unchanged.

**READ THIS BEFORE STEP 5. Never invent a rate.** The existing table records its source and a cached-on date, and carries a REVIEW DATE for exactly the reason that a silently wrong rate for a known model is far worse than an unknown model. If you cannot find a rate for a Codex model from a primary source you can cite, DO NOT ADD IT. Leave it out, report which models you could not verify, and the rows stay unpriced through the existing NULL path. Reporting NEEDS_CONTEXT on that point is a correct outcome, not a failure.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { priceTokens } from "../server/ingest/transcripts/pricing.js";

const EMPTY = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
};

describe("priceTokens", () => {
  it("prices a known model from its token counts", () => {
    // claude-opus-5 is $5/MTok in, $25/MTok out.
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(30, 10);
  });

  it("returns null for a model it does not know, never zero", () => {
    // Zero would read as free and understate the total. This is the invariant
    // the whole cost feature is built on.
    expect(priceTokens({ ...EMPTY, model: "no-such-model", inputTokens: 1_000_000 })).toBeNull();
  });

  it("applies the cache read discount", () => {
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", cacheReadTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.5, 10);
  });

  it("uses fast rates when speed is fast", () => {
    const cost = priceTokens({ ...EMPTY, model: "claude-opus-5", speed: "fast", inputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(10, 10);
  });

  it("is zero for a known model with no tokens", () => {
    // Distinct from null: we know the rate, there was simply nothing to bill.
    expect(priceTokens({ ...EMPTY, model: "claude-opus-5" })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-pricing.test.ts`
Expected: FAIL. `priceTokens` is not exported.

- [ ] **Step 3: Extract `priceTokens`**

In `server/ingest/transcripts/pricing.ts`, add the interface and the function, and rewrite `priceRecord` to delegate. The arithmetic is unchanged; only its input shape is:

```ts
/**
 * Token counts for one priceable unit of work, independent of where they came
 * from. A transcript record and an OTLP metric point both reduce to this.
 */
export interface TokenCounts {
  model: string;
  /** "fast" selects the premium rate table. Null or absent means standard. */
  speed?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
}

/**
 * Cost in USD for a set of token counts, or null when the model is unknown.
 *
 * Null is deliberate and is never coerced to zero: a silent zero would
 * understate spend and quietly corrupt the total this whole feature exists to
 * make trustworthy. Zero is returned only when the model IS known and there
 * were genuinely no tokens.
 */
export function priceTokens(counts: TokenCounts): number | null {
  const table = counts.speed === "fast" ? FAST_RATES : RATES;
  const rate = table[counts.model] ?? (counts.speed === "fast" ? RATES[counts.model] : undefined);
  if (!rate) return null;

  const input = counts.inputTokens * rate.input;
  const output = counts.outputTokens * rate.output;
  const cacheRead = counts.cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER;
  const write5m = counts.cacheCreation5mTokens * rate.input * CACHE_WRITE_5M_MULTIPLIER;
  const write1h = counts.cacheCreation1hTokens * rate.input * CACHE_WRITE_1H_MULTIPLIER;

  return (input + output + cacheRead + write5m + write1h) / PER_MILLION;
}
```

Then replace the body of `priceRecord` with a delegation, keeping its existing doc comment about cache reads not being persisted:

```ts
export function priceRecord(record: UsageRecord): number | null {
  return priceTokens(record);
}
```

`UsageRecord` already has every field of `TokenCounts`, so it satisfies the parameter structurally. If TypeScript disagrees, construct the object explicitly rather than widening `TokenCounts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-pricing.test.ts && npx vitest run tests/ingest-pricing.test.ts`
Expected: PASS. The existing transcript pricing tests must be unaffected, because the arithmetic did not change. If any moves, the extraction is wrong.

If `tests/ingest-pricing.test.ts` does not exist under that name, run the whole suite and confirm no existing pricing assertion moved.

- [ ] **Step 5: Add non-Anthropic rates, only those you can cite**

Find the current published per-million input and output prices for the models Codex uses. Then, in `pricing.ts`, add a clearly separated block:

```ts
// Non-Anthropic rates, in USD per million tokens.
//
// Added for OTLP ingestion: Codex reports tokens and no cost, so without these
// a Codex user sees token counts and no spend at all.
//
// SOURCE: <the primary URL you used>
// RATES CACHED: <the date you looked them up>
// REVIEW DATE: <three months after that date>
//
// Same rule as the table above: a model that is not listed here comes out
// unpriced rather than priced at zero. Do not add a rate you cannot cite.
const OPENAI_RATES: Record<string, Rate> = {
  // e.g. "gpt-5-codex": { input: ..., output: ... },
};
```

and fold it into the lookup so `RATES` remains the Anthropic table:

```ts
const ALL_RATES: Record<string, Rate> = { ...RATES, ...OPENAI_RATES };
```

`priceTokens` then reads `ALL_RATES` for the standard table. `FAST_RATES` is Anthropic-only and stays as it is.

Add a test for one model you actually added, asserting a specific figure. If you added none, add a test asserting a representative Codex model prices to `null`, and say so plainly in your report.

`knownModels()` should return the keys of `ALL_RATES`, so the status endpoint keeps telling the truth about what is priceable.

- [ ] **Step 6: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/ingest/transcripts/pricing.ts tests/otlp-pricing.test.ts
git commit -m "feat(pricing): price a set of token counts, whatever produced them"
```

---

### Task 5: Attribution and the ingestion pipeline

**Files:**
- Create: `server/ingest/otlp/attribute.ts`
- Create: `server/ingest/otlp/ingest.ts`
- Test: extend `tests/otlp-route.test.ts` is Task 6; this task's tests go in `tests/otlp-ingest.test.ts` (create)

**Interfaces:**
- Consumes: `parseMetricsPayload` (Task 2), `mapPoint` (Task 3), `priceTokens` (Task 4), `seriesIncrement` (Task 1).
- Produces:
  - `function resolveProjectId(db, resourceAttributes: Record<string, string>): string | null`
  - `function ingestMetricsPayload(db, body: unknown): { recorded: number; unmapped: number; unattributed: number }`

**How a point becomes a row.**

1. Parse the payload into points.
2. For each point, `mapPoint`. A null result increments `unmapped` and stops there.
3. Resolve the quantity: a delta point contributes its value; a cumulative point contributes `seriesIncrement(...)`.
4. Group the resulting quantities by `(resourceAttributes, scopeName, metricName, model, timeUnixNano)` and sum each token kind into one row. Codex sends four points per turn, one per `token_type`, and writing four rows with three zeroed columns each would inflate `entry_count` fourfold and make every row unreadable.
5. Price the grouped counts, attribute them, and insert with an `external_id` so a replay is a no-op.

**The idempotency key.** `external_id = 'otlp:' || groupKey || ':' || timeUnixNano`, where `groupKey` is a sha256 of the resource attributes, scope name, metric name and model, sorted. It deliberately excludes `token_type` (that is what the grouping merges) and `startTimeUnixNano` (that is what identifies a restart, and is handled by the series store). The existing partial unique index on `cost_entries.external_id` enforces it, so a retried export inserts nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-ingest.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { ingestMetricsPayload } from "../server/ingest/otlp/ingest.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function codexPayload(opts: {
  tokens: Record<string, number>;
  cumulative?: boolean;
  time?: string;
  start?: string;
  project?: string;
  model?: string;
}): unknown {
  const resource = opts.project
    ? [{ key: "vibe_dash.project", value: { stringValue: opts.project } }]
    : [];
  return {
    resourceMetrics: [{
      resource: { attributes: resource },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: opts.cumulative
              ? "AGGREGATION_TEMPORALITY_CUMULATIVE"
              : "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: Object.entries(opts.tokens).map(([token_type, sum]) => ({
              attributes: [
                { key: "token_type", value: { stringValue: token_type } },
                { key: "model", value: { stringValue: opts.model ?? "gpt-5-codex" } },
              ],
              startTimeUnixNano: opts.start ?? "1000",
              timeUnixNano: opts.time ?? "2000",
              count: "1",
              sum,
            })),
          },
        }],
      }],
    }],
  };
}

function rows(db: Database.Database) {
  return db.prepare(
    `SELECT input_tokens, output_tokens, cost_usd, project_id, source, external_id
     FROM cost_entries ORDER BY created_at`
  ).all() as { input_tokens: number; output_tokens: number; cost_usd: number | null; project_id: string | null; source: string; external_id: string }[];
}

describe("ingestMetricsPayload", () => {
  it("writes one row per turn, not one per token type", () => {
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { input: 100, output: 20 } }));

    expect(result.recorded).toBe(1);
    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].input_tokens).toBe(100);
    expect(all[0].output_tokens).toBe(20);
    expect(all[0].source).toBe("otlp");
  });

  it("skips the total so figures are not doubled", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100, output: 20, total: 120 } }));

    const all = rows(db);
    expect(all).toHaveLength(1);
    expect(all[0].input_tokens).toBe(100);
    expect(all[0].output_tokens).toBe(20);
  });

  it("records a cumulative series as increments, not running totals", () => {
    // THE test of this feature. Three exports of a climbing total must record
    // 100, then 50, then 30 — not 100, 150, 180, which is what recording the
    // value instead of the increase would produce.
    const at = (time: string, input: number) =>
      ingestMetricsPayload(db, codexPayload({ tokens: { input }, cumulative: true, time }));

    at("2000", 100);
    at("3000", 150);
    at("4000", 180);

    expect(rows(db).map((r) => r.input_tokens)).toEqual([100, 50, 30]);
  });

  it("records a delta series as sent", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, time: "2000" }));
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, time: "3000" }));

    expect(rows(db).map((r) => r.input_tokens)).toEqual([100, 100]);
  });

  it("is idempotent: replaying an export changes nothing", () => {
    const payload = codexPayload({ tokens: { input: 100, output: 20 } });
    ingestMetricsPayload(db, payload);
    ingestMetricsPayload(db, payload);

    expect(rows(db)).toHaveLength(1);
  });

  it("counts a Claude Code payload as unmapped and writes no rows", () => {
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{ scope: { name: "claude-code" }, metrics: [{
          name: "claude_code.token.usage",
          sum: {
            aggregationTemporality: 1,
            dataPoints: [{ attributes: [], startTimeUnixNano: "1", timeUnixNano: "2", asInt: "500" }],
          },
        }] }],
      }],
    };

    const result = ingestMetricsPayload(db, payload);
    expect(result.recorded).toBe(0);
    expect(result.unmapped).toBe(1);
    expect(rows(db)).toHaveLength(0);
  });

  it("attributes to a project named by the resource attribute", () => {
    const project = createProject(db, { name: "demo", description: null });
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, project: "demo" }));

    expect(rows(db)[0].project_id).toBe(project.id);
  });

  it("attributes by project id as well as by name", () => {
    const project = createProject(db, { name: "demo", description: null });
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, project: project.id }));

    expect(rows(db)[0].project_id).toBe(project.id);
  });

  it("records with no project rather than guessing, and counts it", () => {
    const result = ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 } }));

    expect(result.unattributed).toBe(1);
    expect(rows(db)[0].project_id).toBeNull();
  });

  it("stores an unknown model unpriced rather than free", () => {
    ingestMetricsPayload(db, codexPayload({ tokens: { input: 100 }, model: "not-a-real-model" }));

    expect(rows(db)[0].cost_usd).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-ingest.test.ts`
Expected: FAIL. The modules do not exist.

- [ ] **Step 3: Implement attribution**

Create `server/ingest/otlp/attribute.ts`:

```ts
import type Database from "better-sqlite3";

/** The resource attribute a user sets to bind their runner to a project. */
export const PROJECT_ATTRIBUTE = "vibe_dash.project";

/**
 * The project a set of resource attributes names, or null.
 *
 * OTLP carries no working directory, so unlike transcript ingestion there is
 * nothing to match against project_paths and nothing to infer from. A point
 * that names no project stays unattributed, which is the same visible
 * unresolved state as an unmatched transcript directory. Guessing here would
 * put real money against the wrong project with no way to notice.
 *
 * The attribute is matched as a project name first, then as an id, so a user
 * can write whichever they have to hand.
 */
export function resolveProjectId(
  db: Database.Database,
  resourceAttributes: Record<string, string>
): string | null {
  const named = resourceAttributes[PROJECT_ATTRIBUTE];
  if (!named) return null;

  const byName = db.prepare("SELECT id FROM projects WHERE name = ?").get(named) as { id: string } | undefined;
  if (byName) return byName.id;

  const byId = db.prepare("SELECT id FROM projects WHERE id = ?").get(named) as { id: string } | undefined;
  return byId ? byId.id : null;
}
```

- [ ] **Step 4: Implement the pipeline**

Create `server/ingest/otlp/ingest.ts`. Structure it as: parse, then reduce points into a map keyed by group, then write. Key points to honour:

```ts
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { parseMetricsPayload } from "./parse.js";
import { mapPoint } from "./mappers/index.js";
import { seriesIncrement } from "./series.js";
import { resolveProjectId } from "./attribute.js";
import { priceTokens } from "../transcripts/pricing.js";
import type { OtlpPoint } from "./types.js";

const PROVIDER = "openai";

/** Stable hash of everything that identifies one series, EXCEPT its start time. */
function seriesKey(point: OtlpPoint): string {
  return hash([point.metricName, point.scopeName, point.resourceAttributes, point.attributes]);
}

/** Stable hash of one turn, merging the token_type dimension the grouping folds away. */
function groupKey(point: OtlpPoint, model: string): string {
  return hash([point.metricName, point.scopeName, point.resourceAttributes, model]);
}

function hash(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts, sortedReplacer)).digest("hex").slice(0, 32);
}

/** Object key order must not change a hash, so keys are sorted on the way in. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
  }
  return value;
}
```

The body then:

1. `const points = parseMetricsPayload(body)`.
2. For each point: `const mapped = mapPoint(point)`. If null, `unmapped++` and continue.
3. `const quantity = point.cumulative ? seriesIncrement(db, seriesKey(point), point.startTimeUnixNano, point.value) : point.value`. Skip when `quantity <= 0`: a cumulative point that has not moved is not new spend, and writing a zero row would inflate `entry_count`.
4. Accumulate into a `Map<string, {...}>` keyed by `` `${groupKey(point, mapped.model)}:${point.timeUnixNano}` ``, summing `inputTokens`, `outputTokens` and `cacheReadTokens` by `mapped.kind`, and remembering the point's `resourceAttributes` and `timeUnixNano`.
5. For each group: `priceTokens({ model, speed: null, inputTokens, outputTokens, cacheReadTokens, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 })`, resolve the project, count `unattributed` when it is null, and insert:

```ts
db.prepare(
  `INSERT OR IGNORE INTO cost_entries
     (id, agent_id, task_id, milestone_id, project_id, model, provider,
      input_tokens, output_tokens, cost_usd, created_at, source, external_id)
   VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'otlp', ?)`
).run(randomUUID(), projectId, model, PROVIDER, inputTokens, outputTokens, cost, createdAt, externalId);
```

`recorded` counts rows whose insert reported `changes > 0`, so a replay reports zero recorded rather than claiming work it did not do. Wrap the whole write loop in `db.transaction(...)` so a malformed group cannot half-apply.

`created_at` is `new Date().toISOString()`. The point's `timeUnixNano` is the exporter's clock and is used only for the idempotency key, not as the row's timestamp: mixing two clocks in a column the dashboard groups by day would put spend on the wrong day when they disagree.

Cache-read tokens are priced and then dropped, exactly as transcript ingestion already does, because `cost_entries` has no column for them. That known limitation is inherited here rather than introduced, and Task 7 mentions it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-ingest.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Run the gate and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/ingest/otlp/attribute.ts server/ingest/otlp/ingest.ts tests/otlp-ingest.test.ts
git commit -m "feat(otlp): turn metric points into priced, attributed cost rows"
```

---

### Task 6: The endpoint and the status counters

**Files:**
- Create: `server/routes/otlp.ts`
- Modify: `server/routes/index.ts`
- Modify: `server/ingest/transcripts/sync.ts` (`getIngestStatus`)
- Modify: `server/ingest/otlp/ingest.ts` (add and export `unmappedPointCount`)
- Modify: `server/index.ts` (mount the OTLP body parser before the global one)
- Test: `tests/otlp-route.test.ts` (create)

**Interfaces:**
- Consumes: `ingestMetricsPayload` from Task 5.
- Produces: `POST /v1/metrics`, and `otlpRows`, `otlpUnmapped`, `otlpUnattributed` on the ingest status.

**The OTLP/HTTP response contract, which is not this repo's usual one.** Exporters act on the status code, so this endpoint does not return `{ error }`:

| Outcome | Status | Body |
|---|---|---|
| Accepted | `200` | `{}` (an empty `ExportMetricsServiceResponse`) |
| Body is not valid OTLP | `400` | `{}` |
| Rate limited | `429` | handled by the limiter |

A `400` tells a well-behaved exporter not to retry, which is right for a malformed body. Anything retryable relies on Task 5's idempotency to make the retry harmless.

- [ ] **Step 1: Write the failing test**

Create `tests/otlp-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { otlpRoutes } from "../server/routes/otlp.js";
import { getIngestStatus } from "../server/ingest/transcripts/sync.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(otlpRoutes(db, () => {}));
});

function codexPayload(input: number, project?: string): unknown {
  return {
    resourceMetrics: [{
      resource: {
        attributes: project ? [{ key: "vibe_dash.project", value: { stringValue: project } }] : [],
      },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5-codex" } },
              ],
              startTimeUnixNano: "1000",
              timeUnixNano: "2000",
              count: "1",
              sum: input,
            }],
          },
        }],
      }],
    }],
  };
}

describe("POST /v1/metrics", () => {
  it("accepts a Codex export and records it", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", codexPayload(100));

    expect(res.status).toBe(200);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'otlp'").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("returns an empty ExportMetricsServiceResponse, as OTLP requires", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", codexPayload(100));
    expect(res.body).toEqual({});
  });

  it("rejects a body that is not an OTLP object with 400 and writes nothing", async () => {
    // A JSON array specifically: express.json accepts it, so it reaches our
    // handler and exercises the route's own 400 path. A bare string would be
    // rejected by the body parser first and would only prove body-parser works.
    const res = await requestApp(app, "POST", "/v1/metrics", []);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({});
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_entries").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("accepts an empty payload without error", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", { resourceMetrics: [] });
    expect(res.status).toBe(200);
  });

  it("broadcasts when rows were recorded", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(otlpRoutes(db, (e) => { events.push(e as { type: string }); }));

    await requestApp(app, "POST", "/v1/metrics", codexPayload(100));
    expect(events.map((e) => e.type)).toContain("cost_ingested");
  });

  it("does not broadcast when nothing was recorded", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(otlpRoutes(db, (e) => { events.push(e as { type: string }); }));

    await requestApp(app, "POST", "/v1/metrics", { resourceMetrics: [] });
    expect(events).toHaveLength(0);
  });
});

describe("the ingest status reports OTLP", () => {
  it("counts recorded, unmapped and unattributed points", async () => {
    await requestApp(app, "POST", "/v1/metrics", codexPayload(100));

    const status = getIngestStatus(db);
    expect(status.otlpRows).toBe(1);
    expect(status.otlpUnattributed).toBe(1);
  });

  it("does not count an attributed row as unattributed", async () => {
    createProject(db, { name: "demo", description: null });
    await requestApp(app, "POST", "/v1/metrics", codexPayload(100, "demo"));

    expect(getIngestStatus(db).otlpUnattributed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/otlp-route.test.ts`
Expected: FAIL. The route module does not exist.

- [ ] **Step 3: Add the route**

Create `server/routes/otlp.ts`, following the shape of `server/routes/ingest.ts`:

```ts
import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import { ingestMetricsPayload } from "../ingest/otlp/ingest.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// An exporter posts on its own interval, typically every 60 seconds, and one
// machine may run several agents. The ceiling only has to sit above that.
const otlpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {},
});

// A batch of metric points is larger than a normal API call, so this route gets
// its own body limit rather than raising the global one.
//
// This parser only takes effect because server/index.ts mounts it for this path
// BEFORE the global express.json. body-parser marks a request as parsed and the
// second parser then no-ops, so mounting it here alone would silently leave the
// global 256kb cap in force.
const otlpBody = json({ limit: "1mb" });

export const otlpRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  /**
   * POST /v1/metrics — OTLP/JSON metrics from a coding agent.
   *
   * The path is fixed by the OTLP/HTTP convention: an exporter appends
   * /v1/metrics to whatever endpoint the user configures, so pointing a runner
   * at http://localhost:3001 is the whole of its setup.
   *
   * Responses follow the OTLP contract rather than this repo's { error } shape,
   * because exporters act on the status code: 400 tells a sender not to retry a
   * body that will never parse, and anything retryable is made harmless by the
   * external_id idempotency in the ingest layer.
   */
  router.post("/v1/metrics", otlpLimiter, otlpBody, (req, res) => {
    try {
      const result = ingestMetricsPayload(db, req.body);
      if (result.recorded > 0) {
        broadcast({ type: "cost_ingested", payload: {
          filesScanned: 0,
          recordsIngested: result.recorded,
          recordsSkipped: 0,
          unpriced: 0,
          unattributed: result.unattributed,
        } });
      }
      return res.status(200).json({});
    } catch (err) {
      logger.warn({ err }, "rejected an OTLP metrics payload");
      return res.status(400).json({});
    }
  });

  return router;
};
```

Register it in `server/routes/index.ts` by adding `otlpRoutes` to the `routeFactories` array, following the existing import style.

**Then make the larger body limit real.** `server/index.ts` calls
`app.use(express.json({ limit: "256kb" }))` at line 60, before it mounts the
router. body-parser sets a flag once it has parsed a request, so a second parser
inside the route is a no-op and the 256kb cap would silently remain. Mount the
OTLP parser for that path first, immediately above the existing global line:

```ts
// OTLP metric batches are larger than a normal API call. This must precede the
// global parser below: whichever runs first is the one whose limit applies.
app.use("/v1/metrics", express.json({ limit: "1mb" }));
app.use(express.json({ limit: "256kb" }));
```

Note also that `createRouter` applies a global `apiLimiter` whose 429 body is
`{ error: ... }`, which is not the OTLP shape. Leave it alone. Exporters act on
the status code, and changing a limiter shared by every route to suit one
endpoint would be the wrong trade.

- [ ] **Step 4: Add the status counters**

In `server/ingest/transcripts/sync.ts`, extend `getIngestStatus`'s return type and body with three counts, using the same `one(sql)` helper the existing counters use:

```ts
    otlpRows: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'otlp'`),
    otlpUnattributed: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'otlp' AND project_id IS NULL`),
```

`otlpUnmapped` is not derivable from the tables, because an unmapped point writes no row. Count it in a module-level counter in `server/ingest/otlp/ingest.ts`, exported as `unmappedPointCount()`, incremented as points are skipped, and read here. Say plainly in a comment that this counter is process-lifetime and resets on restart, unlike the others which are queries. A user watching it to find out whether their runner is recognised needs it now, not across restarts, so the weaker guarantee is acceptable and must be stated rather than hidden.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/otlp-route.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS. `tests/ingest-routes.test.ts` asserts the status keys with `toMatchObject`, so added keys must not break it.

- [ ] **Step 7: Commit**

```bash
git add server/routes/otlp.ts server/routes/index.ts server/index.ts server/ingest/transcripts/sync.ts server/ingest/otlp/ingest.ts tests/otlp-route.test.ts
git commit -m "feat(otlp): accept OTLP metrics at /v1/metrics and report what was ignored"
```

---

### Task 7: Documentation

No code. The two previous features in this area both shipped documentation that overstated what the code did, and both were caught in review. The limits below are as much the deliverable as the setup instructions.

**Files:**
- Modify: `docs/ingestion.md`
- Modify: `README.md`

- [ ] **Step 1: Write the Codex setup section**

Add a section to `docs/ingestion.md` covering:

- The `config.toml` block, with the endpoint pointing at the Vibe Dash server:

```toml
[otel]
metrics_exporter = "otlp-http"

[otel.exporter.otlp-http]
endpoint = "http://localhost:3001"
protocol = "json"
```

- Binding spend to a project with `OTEL_RESOURCE_ATTRIBUTES=vibe_dash.project=<name or id>`, and that without it the spend is recorded and shown as Unattributed rather than dropped.

- [ ] **Step 2: State the limits plainly**

In the same section, and not in a parenthetical:

1. **Interactive CLI only.** `codex exec` emits logs and traces but no metrics, and `codex mcp-server` emits no telemetry at all, so headless runs produce nothing. Cite [openai/codex#12913](https://github.com/openai/codex/issues/12913).
2. **Not retroactive.** Unlike transcript ingestion, nothing is recorded for sessions that ran before the exporter was switched on. There is no backfill.
3. **Claude Code is not read here.** Pointing a Claude Code exporter at this endpoint records nothing and increments the unmapped count. Claude Code cost comes from transcripts, and having two sources for the same spend is what causes double counting.
4. **Runners need a mapper.** A runner Vibe Dash has no mapper for has its points counted as unmapped and nothing else. Say which runners are mapped, which today is Codex alone.

Verify each of these against the code before writing it rather than trusting this plan.

- [ ] **Step 3: Correct the README**

`README.md` describes cost ingestion. Add OTLP beside transcripts, worded as coverage for "runners with a mapper" rather than "any runner", per D6.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS.

Confirm no stale claim survives:

```bash
grep -rn "any runner" README.md docs/
```

Expected: no hit that promises coverage the code does not have.

```bash
git add README.md docs/ingestion.md
git commit -m "docs: how to send Codex cost over OTLP, and what it does not cover"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm the spec's five success criteria:

1. A Codex CLI configured with a short `config.toml` block produces cost rows on the dashboard with no `log_cost` call.
2. The same session exported cumulatively and exported delta produce identical totals. The cumulative test in Task 5 is the proof; re-read it and confirm it would fail if the increment logic were removed.
3. Replaying any export changes no total.
4. A Claude Code exporter pointed at the endpoint produces no cost rows and a visible unmapped count.
5. Adding a second runner mapper touches one new file under `mappers/` and its test, and no part of the receiver.
