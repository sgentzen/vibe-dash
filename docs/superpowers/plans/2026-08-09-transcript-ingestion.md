# Transcript Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read Claude Code's local transcript files so per-project token and cost figures are correct whether or not any agent called `log_cost`.

**Architecture:** One deep module, `server/ingest/transcripts/`, exposing a single `syncTranscripts(db, opts)` entry point. It streams JSONL files from the Claude home, extracts usage records, prices them from a static table, attributes them to a project by directory path, and inserts them into `cost_entries` with `source='transcript'`. Idempotency is enforced by a partial unique index on the record `uuid`, not by application logic. A byte-offset cursor per file makes re-scans incremental.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions in relative imports), better-sqlite3 with raw SQL, Express 5 route factories, Vitest integration tests against a real in-memory database.

## Global Constraints

Copied verbatim from the spec and the repository's CLAUDE.md. Every task's requirements implicitly include this section.

- **Spec:** `docs/superpowers/specs/2026-08-09-transcript-ingestion-design.md`. Read it before Task 1.
- **No ORM.** Raw SQL with better-sqlite3 prepared statements.
- **Primary keys:** TEXT UUIDs via `randomUUID()` from `node:crypto`.
- **Timestamps:** ISO 8601 strings via `new Date().toISOString()`.
- **All DB functions take `db: Database.Database` as the first parameter.**
- **Imports:** ESM with explicit `.js` extensions in relative imports.
- **Naming:** PascalCase types, camelCase functions, snake_case DB columns and tables.
- **Tests:** live in `tests/`, named `*.test.ts`; each gets a fresh in-memory DB via `beforeEach(() => { db = createTestDb(); })`; integration style, no mocking.
- **Style:** Australian English in user-facing prose and documents. No em-dashes. No emojis.
- **Never guess a price.** All rates come from the `claude-api` skill, recorded in Task 3.
- **Unattributed and unpriced are visible states, never silent defaults.** Spend with no matching project keeps `project_id` NULL. An unknown model stores tokens with `cost_usd` NULL.
- **The gate before any completing commit** is the `finish-task` skill.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/db/migrator.ts` (modify) | Add migration `019_transcript_ingestion` |
| `server/ingest/transcripts/types.ts` (create) | `UsageRecord`, `SyncResult`, `SyncOptions` |
| `server/ingest/transcripts/parse.ts` (create) | Stream one JSONL file, yield `UsageRecord`, tolerate junk |
| `server/ingest/transcripts/pricing.ts` (create) | Model to rates; tokens to USD; unknown model to null |
| `server/ingest/transcripts/attribute.ts` (create) | Normalise `cwd`; resolve to `project_id` or NULL |
| `server/ingest/transcripts/discover.ts` (create) | Enumerate `*.jsonl` under the Claude home |
| `server/ingest/transcripts/sync.ts` (create) | Orchestration, byte-offset cursor, transaction boundaries |
| `server/db/projectPaths.ts` (create) | CRUD for `project_paths` |
| `server/routes/ingest.ts` (create) | `POST /api/ingest/scan`, `GET /api/ingest/status` |
| `server/routes/index.ts` (modify) | Register `ingestRoutes` in `routeFactories` |
| `server/index.ts` (modify) | Background scan after `listen` |
| `tests/fixtures/transcripts/**` (create) | JSONL fixtures |
| `tests/ingest-*.test.ts` (create) | Per-module tests |
| `docs/ingestion.md` (create) | What is read, derived, inferred, and not known |

Only `sync.ts` and `projectPaths.ts` are imported outside the module. `parse`, `pricing`, `attribute` and `discover` are internal.

---

### Task 1: Migration 019, ingestion schema

**Files:**
- Modify: `server/db/migrator.ts` (append to the `MIGRATIONS` array, after `018_drop_comments_notifications`)
- Test: `tests/ingest-migration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `cost_entries` gains `source TEXT NOT NULL DEFAULT 'mcp'`, `external_id TEXT`, `cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0`, `cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0`; new tables `project_paths(id, project_id, path, created_at)` and `transcript_files(path, size, mtime, byte_offset, last_uuid, updated_at)`; unique index `idx_cost_entries_external_id`.

Note the spec said a single `cache_creation_tokens`. Two columns replace it: Anthropic prices 5-minute cache writes at 1.25x input and 1-hour writes at 2x, and the transcripts record `ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` separately, so keeping them apart is what makes the cost figure exact.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-migration.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

interface ColumnRow { name: string; notnull: number; dflt_value: string | null }

describe("migration 019_transcript_ingestion", () => {
  it("adds the source and cache-token columns to cost_entries", () => {
    const cols = db.pragma("table_info(cost_entries)") as ColumnRow[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.has("source")).toBe(true);
    expect(byName.get("source")!.dflt_value).toBe("'mcp'");
    expect(byName.has("external_id")).toBe(true);
    expect(byName.has("cache_creation_5m_tokens")).toBe(true);
    expect(byName.has("cache_creation_1h_tokens")).toBe(true);
  });

  it("enforces uniqueness on external_id but allows many NULLs", () => {
    const insert = db.prepare(
      `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, 'claude-opus-5', 'anthropic', 1, 1, 0.1, '2026-08-09T00:00:00.000Z', ?, ?)`
    );

    // Many NULL external_ids are fine — that is every pre-existing MCP row.
    insert.run("a", "mcp", null);
    insert.run("b", "mcp", null);

    insert.run("c", "transcript", "uuid-1");
    expect(() => insert.run("d", "transcript", "uuid-1")).toThrow(/UNIQUE/i);
  });

  it("creates project_paths with a unique path", () => {
    db.prepare(`INSERT INTO projects (id, name, description, created_at, updated_at)
                VALUES ('p1', 'demo', NULL, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z')`).run();
    const insert = db.prepare(
      `INSERT INTO project_paths (id, project_id, path, created_at)
       VALUES (?, 'p1', ?, '2026-08-09T00:00:00.000Z')`
    );
    insert.run("pp1", "c:/users/sgent/projects/demo");
    expect(() => insert.run("pp2", "c:/users/sgent/projects/demo")).toThrow(/UNIQUE/i);
  });

  it("creates transcript_files keyed by path", () => {
    const cols = db.pragma("table_info(transcript_files)") as ColumnRow[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["byte_offset", "last_uuid", "mtime", "path", "size", "updated_at"]
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-migration.test.ts`
Expected: FAIL. `no such column: source`, `no such table: project_paths`.

- [ ] **Step 3: Add the migration**

Append this object to the `MIGRATIONS` array in `server/db/migrator.ts`, immediately after the `018_drop_comments_notifications` entry and before the closing `];`:

```ts
  {
    name: "019_transcript_ingestion",
    run(db) {
      // Cost rows now come from two places: an agent calling log_cost ('mcp')
      // and Claude Code transcripts read off disk ('transcript'). Tagging the
      // source is what stops the two double-counting the same spend.
      //
      // external_id holds the transcript record's own uuid. The partial unique
      // index below is the whole idempotency guarantee: re-scanning a file can
      // never insert a row twice, and it is enforced by the database rather
      // than by application logic that could regress.
      //
      // Cache writes are split by TTL because they are priced differently
      // (1.25x input for 5-minute, 2x for 1-hour) and the transcript reports
      // them separately. Folding them together would make cost_usd
      // unauditable.
      db.exec(`
        ALTER TABLE cost_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'mcp';
        ALTER TABLE cost_entries ADD COLUMN external_id TEXT;
        ALTER TABLE cost_entries ADD COLUMN cache_creation_5m_tokens INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE cost_entries ADD COLUMN cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_entries_external_id
          ON cost_entries(external_id) WHERE external_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_cost_entries_source
          ON cost_entries(source);

        -- One project has many directories once git worktrees are in use, so
        -- this is a table rather than a column on projects. Paths are stored
        -- already normalised (see attribute.ts) so lookup is string equality.
        CREATE TABLE IF NOT EXISTS project_paths (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id),
          path TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_project_paths_project ON project_paths(project_id);

        -- The incremental cursor. byte_offset is where the last scan stopped,
        -- so a steady-state scan costs time proportional to new bytes rather
        -- than to the number of transcripts on disk.
        CREATE TABLE IF NOT EXISTS transcript_files (
          path TEXT PRIMARY KEY,
          size INTEGER NOT NULL,
          mtime TEXT NOT NULL,
          byte_offset INTEGER NOT NULL DEFAULT 0,
          last_uuid TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ingest-migration.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. The migrator test (`tests/migrator.test.ts`) asserts on the migration list, so if it fails on a count or name, update it to include `019_transcript_ingestion` rather than removing the assertion.

- [ ] **Step 6: Commit**

```bash
git add server/db/migrator.ts tests/ingest-migration.test.ts
git commit -m "feat(db): add migration 019 for transcript cost ingestion"
```

---

### Task 2: Parse transcript JSONL

**Files:**
- Create: `server/ingest/transcripts/types.ts`, `server/ingest/transcripts/parse.ts`
- Create: `tests/fixtures/transcripts/basic.jsonl`, `tests/fixtures/transcripts/messy.jsonl`
- Test: `tests/ingest-parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface UsageRecord { uuid: string; sessionId: string; timestamp: string; cwd: string | null; gitBranch: string | null; model: string; speed: string | null; isSidechain: boolean; inputTokens: number; outputTokens: number; cacheCreation5mTokens: number; cacheCreation1hTokens: number; cacheReadTokens: number }`
  - `interface ParseResult { records: UsageRecord[]; skippedLines: number; bytesRead: number; lastUuid: string | null }`
  - `function parseTranscript(text: string): ParseResult`

- [ ] **Step 1: Create the fixtures**

`tests/fixtures/transcripts/basic.jsonl` (two assistant records with usage, one user record without):

```
{"type":"user","uuid":"u-1","sessionId":"s-1","timestamp":"2026-08-09T10:00:00.000Z","cwd":"C:\\Users\\sgent\\projects\\demo","message":{"role":"user","content":"hi"}}
{"type":"assistant","uuid":"a-1","sessionId":"s-1","timestamp":"2026-08-09T10:00:01.000Z","cwd":"C:\\Users\\sgent\\projects\\demo","gitBranch":"main","isSidechain":false,"message":{"model":"claude-opus-5","usage":{"input_tokens":10,"output_tokens":20,"cache_read_input_tokens":100,"cache_creation_input_tokens":50,"cache_creation":{"ephemeral_5m_input_tokens":50,"ephemeral_1h_input_tokens":0},"speed":"standard"}}}
{"type":"assistant","uuid":"a-2","sessionId":"s-1","timestamp":"2026-08-09T10:00:02.000Z","cwd":"C:\\Users\\sgent\\projects\\demo","gitBranch":"main","isSidechain":true,"message":{"model":"claude-haiku-4-5","usage":{"input_tokens":5,"output_tokens":6,"cache_read_input_tokens":0,"cache_creation_input_tokens":80,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":80}}}}
```

`tests/fixtures/transcripts/messy.jsonl` (junk the parser must survive):

```
{"type":"assistant","uuid":"m-1","sessionId":"s-2","timestamp":"2026-08-09T11:00:00.000Z","cwd":"/home/dev/app","message":{"model":"claude-sonnet-5","usage":{"input_tokens":1,"output_tokens":2}}}
this is not json at all
{"type":"assistant","uuid":"m-2","message":{"model":"claude-opus-5"}}
{"type":"assistant","sessionId":"s-2","timestamp":"2026-08-09T11:00:02.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":3,"output_tokens":4}}}

{"type":"assistant","uuid":"m-3","sessionId":"s-2","timestamp":"2026-08-09T11:00:03.000Z","cwd":"/home/dev/app","message":{"model":"claude-opus-5","usage":{"input_tokens":7,"output_tokens":8}}}
```

Line 2 is not JSON. Line 3 has no `usage`. Line 4 has no `uuid` (cannot be deduplicated, so it must be skipped, not ingested). Line 5 is blank.

- [ ] **Step 2: Write the failing test**

Create `tests/ingest-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../server/ingest/transcripts/parse.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "transcripts");
const read = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

describe("parseTranscript", () => {
  it("extracts only assistant records that carry usage", () => {
    const result = parseTranscript(read("basic.jsonl"));
    expect(result.records.map((r) => r.uuid)).toEqual(["a-1", "a-2"]);
  });

  it("reads every token class, including both cache TTLs", () => {
    const [first] = parseTranscript(read("basic.jsonl")).records;
    expect(first).toMatchObject({
      uuid: "a-1",
      sessionId: "s-1",
      model: "claude-opus-5",
      gitBranch: "main",
      isSidechain: false,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheCreation5mTokens: 50,
      cacheCreation1hTokens: 0,
      speed: "standard",
    });
    expect(first.cwd).toBe("C:\\Users\\sgent\\projects\\demo");
  });

  it("keeps sidechain (subagent) records, flagged", () => {
    const second = parseTranscript(read("basic.jsonl")).records[1];
    expect(second.isSidechain).toBe(true);
    expect(second.cacheCreation1hTokens).toBe(80);
  });

  it("survives junk lines and counts them", () => {
    const result = parseTranscript(read("messy.jsonl"));
    // m-1 and m-3 are valid. Skipped: unparseable line, no-usage record,
    // and the record with no uuid (nothing to deduplicate on).
    expect(result.records.map((r) => r.uuid)).toEqual(["m-1", "m-3"]);
    expect(result.skippedLines).toBe(3);
  });

  it("reports the last uuid seen, for cursor bookkeeping", () => {
    expect(parseTranscript(read("messy.jsonl")).lastUuid).toBe("m-3");
  });

  it("treats a missing cache_creation block as zero rather than throwing", () => {
    const [only] = parseTranscript(
      `{"type":"assistant","uuid":"x","sessionId":"s","timestamp":"2026-08-09T00:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1}}}`
    ).records;
    expect(only.cacheCreation5mTokens).toBe(0);
    expect(only.cacheCreation1hTokens).toBe(0);
    expect(only.cacheReadTokens).toBe(0);
  });

  it("returns an empty result for empty input", () => {
    expect(parseTranscript("")).toEqual({ records: [], skippedLines: 0, bytesRead: 0, lastUuid: null });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-parse.test.ts`
Expected: FAIL. cannot resolve `../server/ingest/transcripts/parse.js`.

- [ ] **Step 4: Write `types.ts`**

Create `server/ingest/transcripts/types.ts`:

```ts
/** One priced-able assistant turn extracted from a Claude Code transcript. */
export interface UsageRecord {
  /** The transcript record's own uuid. Doubles as the idempotency key. */
  uuid: string;
  sessionId: string;
  timestamp: string;
  /** Working directory the session ran in. Used for project attribution. */
  cwd: string | null;
  gitBranch: string | null;
  model: string;
  /** "standard" or "fast". Fast mode is priced differently. */
  speed: string | null;
  /** True for subagent turns, which are billed the same but worth flagging. */
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
}

export interface ParseResult {
  records: UsageRecord[];
  /** Lines that could not be used. Surfaced so a format change is visible. */
  skippedLines: number;
  bytesRead: number;
  lastUuid: string | null;
}

export interface SyncOptions {
  /** Override the Claude home. Tests point this at a fixture directory. */
  claudeHome?: string;
}

export interface SyncResult {
  filesScanned: number;
  recordsIngested: number;
  recordsSkipped: number;
  /** Ingested but with cost_usd NULL because the model is not in the price table. */
  unpriced: number;
  /** Ingested but with project_id NULL because no project_paths row matched. */
  unattributed: number;
}
```

- [ ] **Step 5: Write `parse.ts`**

Create `server/ingest/transcripts/parse.ts`:

```ts
import type { ParseResult, UsageRecord } from "./types.js";

// The transcript format is undocumented and can change without notice, so this
// parser is tolerant by construction: unknown fields are ignored, and any line
// it cannot use is skipped and counted rather than thrown. A format break
// therefore degrades to "no new records" plus a rising skipped count, never to
// corrupt cost data.

function asInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Extract a usage record from one parsed line, or null if the line is not one. */
function toUsageRecord(row: Record<string, unknown>): UsageRecord | null {
  if (row.type !== "assistant") return null;

  const message = row.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  // Without a uuid there is no idempotency key, so the record could be
  // double-counted on the next scan. Refuse it rather than risk that.
  const uuid = asString(row.uuid);
  const sessionId = asString(row.sessionId);
  const timestamp = asString(row.timestamp);
  const model = asString(message?.model);
  if (!uuid || !sessionId || !timestamp || !model) return null;

  const cacheCreation = usage.cache_creation as Record<string, unknown> | undefined;

  return {
    uuid,
    sessionId,
    timestamp,
    cwd: asString(row.cwd),
    gitBranch: asString(row.gitBranch),
    model,
    speed: asString(usage.speed),
    isSidechain: row.isSidechain === true,
    inputTokens: asInt(usage.input_tokens),
    outputTokens: asInt(usage.output_tokens),
    cacheCreation5mTokens: asInt(cacheCreation?.ephemeral_5m_input_tokens),
    cacheCreation1hTokens: asInt(cacheCreation?.ephemeral_1h_input_tokens),
    cacheReadTokens: asInt(usage.cache_read_input_tokens),
  };
}

/** Parse a whole transcript body. Never throws on malformed content. */
export function parseTranscript(text: string): ParseResult {
  const records: UsageRecord[] = [];
  let skippedLines = 0;
  let lastUuid: string | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue; // Blank lines are not junk.

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      skippedLines++;
      continue;
    }

    const record = toUsageRecord(row);
    if (record === null) {
      // Most lines legitimately lack usage (user turns, attachments). Only
      // count a skip for assistant rows, so the counter tracks real trouble.
      if (row.type === "assistant") skippedLines++;
      continue;
    }

    records.push(record);
    lastUuid = record.uuid;
  }

  return { records, skippedLines, bytesRead: Buffer.byteLength(text, "utf8"), lastUuid };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/ingest-parse.test.ts`
Expected: PASS, 7 tests.

Note the `messy.jsonl` skip count of 3: the unparseable line, the assistant row with no `usage`, and the assistant row with no `uuid`. The blank line is not counted.

- [ ] **Step 7: Commit**

```bash
git add server/ingest/transcripts/types.ts server/ingest/transcripts/parse.ts tests/ingest-parse.test.ts tests/fixtures/transcripts
git commit -m "feat(ingest): parse Claude Code transcript usage records"
```

---

### Task 3: Pricing

**Files:**
- Create: `server/ingest/transcripts/pricing.ts`
- Test: `tests/ingest-pricing.test.ts`

**Interfaces:**
- Consumes: `UsageRecord` from `./types.js`.
- Produces: `function priceRecord(record: UsageRecord): number | null`, returning USD, or null when the model is not in the table.

Rates are per million tokens, taken from the `claude-api` skill (cached 2026-06-24). Cache multipliers are from the same source: reads cost 0.1x the base input rate, 5-minute writes 1.25x, 1-hour writes 2x.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-pricing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { priceRecord } from "../server/ingest/transcripts/pricing.js";
import type { UsageRecord } from "../server/ingest/transcripts/types.js";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    uuid: "u", sessionId: "s", timestamp: "2026-08-09T00:00:00.000Z",
    cwd: null, gitBranch: null, model: "claude-opus-5", speed: "standard",
    isSidechain: false, inputTokens: 0, outputTokens: 0,
    cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0,
    ...overrides,
  };
}

describe("priceRecord", () => {
  it("prices plain input and output tokens", () => {
    // Opus 5: $5/1M input, $25/1M output.
    const cost = priceRecord(record({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(30, 10);
  });

  it("prices cache reads at a tenth of input", () => {
    expect(priceRecord(record({ cacheReadTokens: 1_000_000 }))).toBeCloseTo(0.5, 10);
  });

  it("prices 5-minute cache writes at 1.25x input and 1-hour at 2x", () => {
    expect(priceRecord(record({ cacheCreation5mTokens: 1_000_000 }))).toBeCloseTo(6.25, 10);
    expect(priceRecord(record({ cacheCreation1hTokens: 1_000_000 }))).toBeCloseTo(10, 10);
  });

  it("prices fast mode on Opus 5 at its own higher rate", () => {
    // Fast mode is $10/$50 rather than $5/$25.
    const cost = priceRecord(record({ speed: "fast", inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(60, 10);
  });

  it("returns null for an unknown model rather than guessing zero", () => {
    expect(priceRecord(record({ model: "claude-something-unreleased", inputTokens: 999 }))).toBeNull();
  });

  it("returns 0, not null, for a known model with no tokens", () => {
    expect(priceRecord(record())).toBe(0);
  });

  it("prices the other current models", () => {
    expect(priceRecord(record({ model: "claude-sonnet-5", inputTokens: 1_000_000 }))).toBeCloseTo(3, 10);
    expect(priceRecord(record({ model: "claude-haiku-4-5", outputTokens: 1_000_000 }))).toBeCloseTo(5, 10);
    expect(priceRecord(record({ model: "claude-fable-5", outputTokens: 1_000_000 }))).toBeCloseTo(50, 10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-pricing.test.ts`
Expected: FAIL. cannot resolve `pricing.js`.

- [ ] **Step 3: Write `pricing.ts`**

Create `server/ingest/transcripts/pricing.ts`:

```ts
import type { UsageRecord } from "./types.js";

// Rates in USD per million tokens, from the `claude-api` skill (rates cached
// 2026-06-24). Static rather than fetched: a local-first tool that needs a
// network call to tell you what you spent has given up the property that makes
// it local-first, and a pricing endpoint is a dependency that can fail or
// disappear.
//
// REVIEW DATE: 2026-11-09. Anthropic publishes rate changes; nothing in this
// tool can detect a stale rate for a model that is still in the table, so this
// needs a human check each quarter. An unknown model is safe (it comes out
// unpriced); a silently wrong rate for a known model is not.
//
// KNOWN LIMITATION: Claude Sonnet 5 has introductory pricing of $2/$10 through
// 2026-08-31, after which it is $3/$15. The standard rate is used here, so
// Sonnet 5 spend inside the introductory window is OVERSTATED. Date-dependent
// rates were left out deliberately: overstating is the safer direction, and the
// alternative is a second class of bug in the money path. Documented in
// docs/ingestion.md.
interface Rate {
  input: number;
  output: number;
}

const RATES: Record<string, Rate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Fast mode runs the same model faster at premium pricing, so it needs its own
// row rather than a multiplier. Only Opus 5 and Opus 4.8 support it.
const FAST_RATES: Record<string, Rate> = {
  "claude-opus-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 10, output: 50 },
};

// Derived from the base input rate.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;

const PER_MILLION = 1_000_000;

/**
 * Cost in USD for one usage record, or null when the model is unknown.
 *
 * Null is deliberate and is never coerced to zero: a silent zero would
 * understate spend and quietly corrupt the total this whole feature exists to
 * make trustworthy. An unpriced record still stores its tokens, so it can be
 * repriced later once the rate is known.
 */
export function priceRecord(record: UsageRecord): number | null {
  const table = record.speed === "fast" ? FAST_RATES : RATES;
  const rate = table[record.model] ?? (record.speed === "fast" ? RATES[record.model] : undefined);
  if (!rate) return null;

  const input = record.inputTokens * rate.input;
  const output = record.outputTokens * rate.output;
  const cacheRead = record.cacheReadTokens * rate.input * CACHE_READ_MULTIPLIER;
  const write5m = record.cacheCreation5mTokens * rate.input * CACHE_WRITE_5M_MULTIPLIER;
  const write1h = record.cacheCreation1hTokens * rate.input * CACHE_WRITE_1H_MULTIPLIER;

  return (input + output + cacheRead + write5m + write1h) / PER_MILLION;
}

/** Exposed for the status endpoint so operators can see what is priceable. */
export function knownModels(): string[] {
  return Object.keys(RATES).sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ingest-pricing.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add server/ingest/transcripts/pricing.ts tests/ingest-pricing.test.ts
git commit -m "feat(ingest): price transcript usage from a static rate table"
```

---

### Task 4: Project attribution

**Files:**
- Create: `server/ingest/transcripts/attribute.ts`, `server/db/projectPaths.ts`
- Test: `tests/ingest-attribute.test.ts`

**Interfaces:**
- Consumes: `project_paths` table from Task 1.
- Produces:
  - `function normalisePath(raw: string): string`
  - `function buildAttributor(db: Database.Database): (cwd: string | null) => string | null`
  - From `projectPaths.ts`: `function linkProjectPath(db, projectId: string, rawPath: string): string` (returns the new row id), `function listProjectPaths(db, projectId?: string): ProjectPath[]`, `function unlinkProjectPath(db, id: string): boolean`, and `interface ProjectPath { id: string; project_id: string; path: string; created_at: string }`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-attribute.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { linkProjectPath, listProjectPaths } from "../server/db/projectPaths.js";
import { normalisePath, buildAttributor } from "../server/ingest/transcripts/attribute.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("normalisePath", () => {
  it("converts separators and strips a trailing slash", () => {
    expect(normalisePath("C:\\Users\\sgent\\projects\\demo\\")).toBe("c:/users/sgent/projects/demo");
  });

  it("lowercases on Windows only", () => {
    const out = normalisePath("/home/Dev/App");
    expect(out).toBe(process.platform === "win32" ? "/home/dev/app" : "/home/Dev/App");
  });

  it("does not require the path to exist on disk", () => {
    // Historical transcripts name directories that may since have been deleted.
    expect(normalisePath("C:\\gone\\forever")).toBe("c:/gone/forever");
  });
});

describe("buildAttributor", () => {
  it("matches an exact linked path", () => {
    const project = createProject(db, "demo", null);
    linkProjectPath(db, project.id, "C:\\Users\\sgent\\projects\\demo");
    expect(buildAttributor(db)("C:\\Users\\sgent\\projects\\demo")).toBe(project.id);
  });

  it("matches a subdirectory by longest prefix", () => {
    const outer = createProject(db, "outer", null);
    const inner = createProject(db, "inner", null);
    linkProjectPath(db, outer.id, "C:/repos");
    linkProjectPath(db, inner.id, "C:/repos/inner");

    expect(buildAttributor(db)("C:/repos/inner/src")).toBe(inner.id);
    expect(buildAttributor(db)("C:/repos/other/src")).toBe(outer.id);
  });

  it("does not match a sibling that merely shares a prefix string", () => {
    const project = createProject(db, "demo", null);
    linkProjectPath(db, project.id, "C:/repos/demo");
    // "C:/repos/demo-old" starts with "C:/repos/demo" as a string but is a
    // different directory. Matching it would attribute money to the wrong project.
    expect(buildAttributor(db)("C:/repos/demo-old")).toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    createProject(db, "demo", null);
    expect(buildAttributor(db)("C:/somewhere/else")).toBeNull();
  });

  it("returns null for a record with no cwd", () => {
    expect(buildAttributor(db)(null)).toBeNull();
  });
});

describe("linkProjectPath", () => {
  it("stores the normalised form so lookups are plain string comparisons", () => {
    const project = createProject(db, "demo", null);
    linkProjectPath(db, project.id, "C:\\Users\\sgent\\projects\\Demo\\");
    expect(listProjectPaths(db, project.id)[0].path).toBe(normalisePath("C:\\Users\\sgent\\projects\\Demo"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-attribute.test.ts`
Expected: FAIL. cannot resolve `projectPaths.js`.

- [ ] **Step 3: Write `projectPaths.ts`**

Create `server/db/projectPaths.ts`:

```ts
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { normalisePath } from "../ingest/transcripts/attribute.js";

export interface ProjectPath {
  id: string;
  project_id: string;
  path: string;
  created_at: string;
}

/**
 * Link a directory to a project so transcript spend from it is attributed.
 *
 * Always a deliberate act: nothing in the ingestion path calls this. Attributing
 * money to the wrong project is worse than leaving it unattributed, and a silent
 * wrong attribution cannot be spotted from the UI.
 */
export function linkProjectPath(db: Database.Database, projectId: string, rawPath: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO project_paths (id, project_id, path, created_at) VALUES (?, ?, ?, ?)`
  ).run(id, projectId, normalisePath(rawPath), new Date().toISOString());
  return id;
}

export function listProjectPaths(db: Database.Database, projectId?: string): ProjectPath[] {
  if (projectId) {
    return db.prepare(`SELECT * FROM project_paths WHERE project_id = ? ORDER BY path`).all(projectId) as ProjectPath[];
  }
  return db.prepare(`SELECT * FROM project_paths ORDER BY path`).all() as ProjectPath[];
}

export function unlinkProjectPath(db: Database.Database, id: string): boolean {
  return db.prepare(`DELETE FROM project_paths WHERE id = ?`).run(id).changes > 0;
}
```

- [ ] **Step 4: Write `attribute.ts`**

Create `server/ingest/transcripts/attribute.ts`:

```ts
import type Database from "better-sqlite3";

/**
 * Canonical form of a directory path for storage and comparison.
 *
 * Deliberately pure string manipulation with no filesystem access: a historical
 * transcript can name a directory that no longer exists, and attribution must
 * not depend on the path still being resolvable.
 *
 * Lowercasing is Windows-only because NTFS is case-insensitive while ext4 is
 * not, so folding case on Linux would merge two genuinely different directories.
 */
export function normalisePath(raw: string): string {
  const forward = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? forward.toLowerCase() : forward;
}

interface PathRow { project_id: string; path: string }

/**
 * Build a cwd-to-project resolver over the current project_paths table.
 *
 * Reads the table once and matches in memory: a scan can process thousands of
 * records and the table is tiny, so a query per record would be wasteful.
 * Returns null when nothing matches, which surfaces as Unattributed.
 */
export function buildAttributor(db: Database.Database): (cwd: string | null) => string | null {
  const rows = db.prepare(`SELECT project_id, path FROM project_paths`).all() as PathRow[];
  // Longest first, so the most specific link wins for nested directories.
  const sorted = [...rows].sort((a, b) => b.path.length - a.path.length);

  return (cwd: string | null): string | null => {
    if (cwd === null) return null;
    const target = normalisePath(cwd);

    for (const row of sorted) {
      if (target === row.path) return row.project_id;
      // The separator check is what stops "C:/repos/demo" claiming
      // "C:/repos/demo-old", which is a different directory entirely.
      if (target.startsWith(`${row.path}/`)) return row.project_id;
    }
    return null;
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/ingest-attribute.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add server/db/projectPaths.ts server/ingest/transcripts/attribute.ts tests/ingest-attribute.test.ts
git commit -m "feat(ingest): attribute transcript spend to projects by path"
```

---

### Task 5: Discovery and sync

**Files:**
- Create: `server/ingest/transcripts/discover.ts`, `server/ingest/transcripts/sync.ts`
- Test: `tests/ingest-sync.test.ts`

**Interfaces:**
- Consumes: `parseTranscript`, `priceRecord`, `buildAttributor`, migration 019.
- Produces:
  - `function discoverTranscripts(claudeHome: string): string[]`
  - `function resolveClaudeHome(override?: string): string`
  - `async function syncTranscripts(db: Database.Database, opts?: SyncOptions): Promise<SyncResult>`
  - `function getIngestStatus(db: Database.Database): { filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number }`

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-sync.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { linkProjectPath } from "../server/db/projectPaths.js";
import { syncTranscripts, getIngestStatus } from "../server/ingest/transcripts/sync.js";

let db: Database.Database;
let home: string;

const line = (uuid: string, cwd: string, model = "claude-opus-5"): string =>
  JSON.stringify({
    type: "assistant", uuid, sessionId: "s-1", timestamp: "2026-08-09T10:00:00.000Z", cwd,
    message: { model, usage: { input_tokens: 1_000_000, output_tokens: 0 } },
  }) + "\n";

beforeEach(() => {
  db = createTestDb();
  home = mkdtempSync(path.join(tmpdir(), "vd-transcripts-"));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function writeTranscript(name: string, body: string): string {
  const file = path.join(home, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return file;
}

const rowCount = (): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`).get() as { n: number }).n;

describe("syncTranscripts", () => {
  it("ingests records and prices them", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    const result = await syncTranscripts(db, { claudeHome: home });

    expect(result.recordsIngested).toBe(1);
    const row = db.prepare(`SELECT * FROM cost_entries WHERE external_id = 'a-1'`).get() as
      { cost_usd: number; source: string; input_tokens: number; project_id: string | null };
    expect(row.source).toBe("transcript");
    expect(row.input_tokens).toBe(1_000_000);
    expect(row.cost_usd).toBeCloseTo(5, 10);
  });

  it("is idempotent: a second sync inserts nothing and changes no total", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/repos/demo"));

    const first = await syncTranscripts(db, { claudeHome: home });
    expect(first.recordsIngested).toBe(2);
    const totalAfterFirst = db.prepare(`SELECT SUM(cost_usd) AS t FROM cost_entries`).get() as { t: number };

    const second = await syncTranscripts(db, { claudeHome: home });
    expect(second.recordsIngested).toBe(0);
    expect(rowCount()).toBe(2);
    const totalAfterSecond = db.prepare(`SELECT SUM(cost_usd) AS t FROM cost_entries`).get() as { t: number };
    expect(totalAfterSecond.t).toBe(totalAfterFirst.t);
  });

  it("picks up appended records without re-reading the whole file", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });

    appendFileSync(file, line("a-2", "C:/repos/demo"), "utf8");
    const second = await syncTranscripts(db, { claudeHome: home });

    expect(second.recordsIngested).toBe(1);
    expect(rowCount()).toBe(2);
  });

  it("re-reads from zero when a file shrinks, without duplicating", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });

    // Rotated or rewritten: smaller than the recorded size.
    writeFileSync(file, line("a-1", "C:/repos/demo"), "utf8");
    const second = await syncTranscripts(db, { claudeHome: home });

    expect(second.recordsIngested).toBe(0); // a-1 already present
    expect(rowCount()).toBe(2);
  });

  it("attributes to a linked project and leaves the rest unattributed", async () => {
    const project = createProject(db, "demo", null);
    linkProjectPath(db, project.id, "C:/repos/demo");
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/elsewhere"));

    const result = await syncTranscripts(db, { claudeHome: home });
    expect(result.unattributed).toBe(1);

    const attributed = db.prepare(`SELECT project_id FROM cost_entries WHERE external_id = 'a-1'`).get() as { project_id: string | null };
    const orphan = db.prepare(`SELECT project_id FROM cost_entries WHERE external_id = 'a-2'`).get() as { project_id: string | null };
    expect(attributed.project_id).toBe(project.id);
    expect(orphan.project_id).toBeNull();
  });

  it("stores an unknown model with NULL cost rather than zero", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo", "claude-not-released-yet"));
    const result = await syncTranscripts(db, { claudeHome: home });

    expect(result.unpriced).toBe(1);
    const row = db.prepare(`SELECT cost_usd, input_tokens FROM cost_entries WHERE external_id = 'a-1'`).get() as
      { cost_usd: number | null; input_tokens: number };
    expect(row.cost_usd).toBeNull();
    expect(row.input_tokens).toBe(1_000_000); // tokens kept, so it can be repriced later
  });

  it("is a no-op when the Claude home does not exist", async () => {
    const result = await syncTranscripts(db, { claudeHome: path.join(home, "nope") });
    expect(result).toMatchObject({ filesScanned: 0, recordsIngested: 0 });
  });

  it("finds transcripts in nested directories, including subagents", async () => {
    writeTranscript("proj/subagents/x.jsonl", line("sa-1", "C:/repos/demo"));
    const result = await syncTranscripts(db, { claudeHome: home });
    expect(result.recordsIngested).toBe(1);
  });

  it("reports status counts", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo", "claude-unknown-x"));
    await syncTranscripts(db, { claudeHome: home });
    expect(getIngestStatus(db)).toMatchObject({ filesTracked: 1, transcriptRows: 1, unpriced: 1, unattributed: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-sync.test.ts`
Expected: FAIL. cannot resolve `sync.js`.

- [ ] **Step 3: Write `discover.ts`**

Create `server/ingest/transcripts/discover.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

// All path inputs here are operator-controlled: the VIBE_DASH_CLAUDE_HOME env
// var, the OS home directory, and names read from the filesystem. None is
// reachable from HTTP or MCP request data.
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal

const CLAUDE_HOME_ENV = "VIBE_DASH_CLAUDE_HOME";

/** Where Claude Code keeps its session transcripts. */
export function resolveClaudeHome(override?: string): string {
  if (override && override.length > 0) return path.resolve(override);
  const fromEnv = process.env[CLAUDE_HOME_ENV];
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  return path.join(homedir(), ".claude", "projects");
}

/**
 * Every *.jsonl under the Claude home, recursively.
 *
 * Recursive because subagent transcripts live in nested `subagents/`
 * directories and their spend counts the same as the parent session's.
 * A missing directory yields an empty list rather than throwing: most machines
 * that run Vibe Dash without Claude Code have no such directory, and that is
 * not an error condition.
 */
export function discoverTranscripts(claudeHome: string): string[] {
  if (!fs.existsSync(claudeHome)) return [];

  const found: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // Unreadable directory: skip it, keep scanning the rest.
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) found.push(full);
    }
  };
  walk(claudeHome);
  return found.sort((a, b) => a.localeCompare(b));
}
```

- [ ] **Step 4: Write `sync.ts`**

Create `server/ingest/transcripts/sync.ts`:

```ts
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../logger.js";
import { discoverTranscripts, resolveClaudeHome } from "./discover.js";
import { parseTranscript } from "./parse.js";
import { priceRecord } from "./pricing.js";
import { buildAttributor } from "./attribute.js";
import type { SyncOptions, SyncResult, UsageRecord } from "./types.js";

const PROVIDER = "anthropic";

interface CursorRow { size: number; byte_offset: number }

/** Read the new tail of a file, given the recorded cursor. */
function readFrom(filePath: string, offset: number): { text: string; size: number; mtime: string } {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  // A file smaller than the recorded size was rotated or rewritten, so the old
  // offset is meaningless. Re-read from zero. Idempotency makes that safe.
  const start = offset <= size ? offset : 0;

  const handle = fs.openSync(filePath, "r");
  try {
    const length = size - start;
    if (length <= 0) return { text: "", size, mtime: stat.mtime.toISOString() };
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return { text: buffer.toString("utf8"), size, mtime: stat.mtime.toISOString() };
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Read Claude Code transcripts and record their spend.
 *
 * Safe to call repeatedly: `external_id` carries the transcript record's uuid
 * and is protected by a partial unique index, so INSERT OR IGNORE makes a
 * re-scan a no-op. That guarantee lives in the database rather than in this
 * function, because money that can be double-counted by one logic bug is not
 * trustworthy money.
 */
export async function syncTranscripts(db: Database.Database, opts: SyncOptions = {}): Promise<SyncResult> {
  const claudeHome = resolveClaudeHome(opts.claudeHome);
  const files = discoverTranscripts(claudeHome);

  const result: SyncResult = {
    filesScanned: 0, recordsIngested: 0, recordsSkipped: 0, unpriced: 0, unattributed: 0,
  };
  if (files.length === 0) return result;

  const attribute = buildAttributor(db);

  const selectCursor = db.prepare(`SELECT size, byte_offset FROM transcript_files WHERE path = ?`);
  const upsertCursor = db.prepare(`
    INSERT INTO transcript_files (path, size, mtime, byte_offset, last_uuid, updated_at)
    VALUES (@path, @size, @mtime, @byte_offset, @last_uuid, @updated_at)
    ON CONFLICT(path) DO UPDATE SET
      size = @size, mtime = @mtime, byte_offset = @byte_offset,
      last_uuid = @last_uuid, updated_at = @updated_at
  `);
  const insertCost = db.prepare(`
    INSERT OR IGNORE INTO cost_entries
      (id, agent_id, task_id, milestone_id, project_id, model, provider,
       input_tokens, output_tokens, cost_usd, created_at,
       source, external_id, cache_creation_5m_tokens, cache_creation_1h_tokens)
    VALUES
      (@id, NULL, NULL, NULL, @project_id, @model, @provider,
       @input_tokens, @output_tokens, @cost_usd, @created_at,
       'transcript', @external_id, @cache_5m, @cache_1h)
  `);

  const ingestFile = db.transaction((filePath: string, records: UsageRecord[]) => {
    let ingested = 0, unpriced = 0, unattributed = 0;
    for (const record of records) {
      const cost = priceRecord(record);
      const projectId = attribute(record.cwd);
      const changes = insertCost.run({
        id: randomUUID(),
        project_id: projectId,
        model: record.model,
        provider: PROVIDER,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        cost_usd: cost,
        created_at: record.timestamp,
        external_id: record.uuid,
        cache_5m: record.cacheCreation5mTokens,
        cache_1h: record.cacheCreation1hTokens,
      }).changes;

      if (changes > 0) {
        ingested++;
        if (cost === null) unpriced++;
        if (projectId === null) unattributed++;
      }
    }
    return { ingested, unpriced, unattributed };
  });

  for (const filePath of files) {
    try {
      const cursor = selectCursor.get(filePath) as CursorRow | undefined;
      const offset = cursor?.byte_offset ?? 0;
      const previousSize = cursor?.size ?? 0;

      const { text, size, mtime } = readFrom(filePath, offset);
      result.filesScanned++;

      // Nothing new and the file has not shrunk: skip without parsing.
      if (text.length === 0 && size === previousSize) continue;

      const parsed = parseTranscript(text);
      result.recordsSkipped += parsed.skippedLines;

      const counts = ingestFile(filePath, parsed.records);
      result.recordsIngested += counts.ingested;
      result.unpriced += counts.unpriced;
      result.unattributed += counts.unattributed;

      upsertCursor.run({
        path: filePath, size, mtime, byte_offset: size,
        last_uuid: parsed.lastUuid, updated_at: new Date().toISOString(),
      });
    } catch (err) {
      // One bad file must not abort the scan.
      logger.warn({ err, filePath }, "transcript file skipped");
    }
  }

  return result;
}

/** Counts behind GET /api/ingest/status, so skipped and unpriced are visible. */
export function getIngestStatus(db: Database.Database): {
  filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number;
} {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    filesTracked: one(`SELECT COUNT(*) AS n FROM transcript_files`),
    transcriptRows: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`),
    unpriced: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND cost_usd IS NULL`),
    unattributed: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND project_id IS NULL`),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/ingest-sync.test.ts`
Expected: PASS, 9 tests.

If `createProject` has a different signature than `createProject(db, name, description)`, check `server/db/projects.ts` and adjust the test's calls. Do not change production code to fit the test.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/ingest/transcripts/discover.ts server/ingest/transcripts/sync.ts tests/ingest-sync.test.ts
git commit -m "feat(ingest): incremental, idempotent transcript sync"
```

---

### Task 6: Routes and server wiring

**Files:**
- Create: `server/routes/ingest.ts`
- Modify: `server/routes/index.ts` (import and add `ingestRoutes` to `routeFactories`)
- Modify: `server/index.ts` (background scan after `listen`)
- Test: `tests/ingest-routes.test.ts`

**Interfaces:**
- Consumes: `syncTranscripts`, `getIngestStatus`, `listProjectPaths`, `linkProjectPath`, `unlinkProjectPath`.
- Produces: `export const ingestRoutes: RouteFactory`.

- [ ] **Step 1: Write the failing test**

Create `tests/ingest-routes.test.ts`. Follow the existing pattern in `tests/routes.test.ts` for building an app around a test database, including its `tests/http-helper.ts` usage:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import express from "express";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { ingestRoutes } from "../server/routes/ingest.js";
import { request } from "./http-helper.js";

let db: Database.Database;
let app: express.Express;

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(ingestRoutes(db, () => {}));
});

describe("GET /api/ingest/status", () => {
  it("returns zeroed counts on a fresh database", async () => {
    const res = await request(app).get("/api/ingest/status");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ filesTracked: 0, transcriptRows: 0, unpriced: 0, unattributed: 0 });
  });
});

describe("project path links", () => {
  it("links a directory to a project and lists it", async () => {
    const project = createProject(db, "demo", null);

    const created = await request(app)
      .post("/api/ingest/paths")
      .send({ project_id: project.id, path: "C:/repos/demo" });
    expect(created.status).toBe(201);

    const listed = await request(app).get("/api/ingest/paths");
    expect(listed.body.paths).toHaveLength(1);
    expect(listed.body.paths[0].project_id).toBe(project.id);
  });

  it("rejects a link with no project_id", async () => {
    const res = await request(app).post("/api/ingest/paths").send({ path: "C:/repos/demo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("rejects a link to a project that does not exist", async () => {
    const res = await request(app)
      .post("/api/ingest/paths")
      .send({ project_id: "no-such-project", path: "C:/repos/demo" });
    expect(res.status).toBe(404);
  });

  it("deletes a link", async () => {
    const project = createProject(db, "demo", null);
    const created = await request(app)
      .post("/api/ingest/paths")
      .send({ project_id: project.id, path: "C:/repos/demo" });

    const deleted = await request(app).delete(`/api/ingest/paths/${created.body.id}`);
    expect(deleted.status).toBe(204);
    expect((await request(app).get("/api/ingest/paths")).body.paths).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ingest-routes.test.ts`
Expected: FAIL. cannot resolve `ingest.js`.

Before writing the route, open `tests/routes.test.ts` and `tests/http-helper.ts` and match whatever request helper they use. If the helper's API differs from `request(app).get(...)`, adapt the test above to it rather than adding a new HTTP helper.

- [ ] **Step 3: Write `ingest.ts`**

Create `server/routes/ingest.ts`:

```ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import { syncTranscripts, getIngestStatus } from "../ingest/transcripts/sync.js";
import { linkProjectPath, listProjectPaths, unlinkProjectPath } from "../db/projectPaths.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// A scan walks the filesystem, so it is far more expensive than a normal read.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many ingest scans, please try again later." },
});

export const ingestRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  /** GET /api/ingest/status — what has been ingested, and what is unresolved. */
  router.get("/api/ingest/status", (_req, res) => {
    res.json(getIngestStatus(db));
  });

  /** POST /api/ingest/scan — read new transcript records now. */
  router.post("/api/ingest/scan", scanLimiter, async (_req, res) => {
    try {
      const result = await syncTranscripts(db);
      if (result.recordsIngested > 0) {
        broadcast({ type: "cost_ingested", payload: result });
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "transcript scan failed");
      res.status(500).json({ error: "Transcript scan failed" });
    }
  });

  /** GET /api/ingest/paths — directory-to-project links. */
  router.get("/api/ingest/paths", (_req, res) => {
    res.json({ paths: listProjectPaths(db) });
  });

  /**
   * POST /api/ingest/paths — link a directory to a project.
   *
   * Always explicit. The ingestion path never creates these itself, because a
   * silent wrong attribution puts money against the wrong project and cannot be
   * spotted from the UI.
   */
  router.post("/api/ingest/paths", (req, res) => {
    const { project_id: projectId, path: rawPath } = req.body as { project_id?: string; path?: string };
    if (!projectId || !rawPath) {
      return res.status(400).json({ error: "project_id and path are required" });
    }

    const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    try {
      const id = linkProjectPath(db, projectId, rawPath);
      broadcast({ type: "project_path_linked", payload: { id, project_id: projectId } });
      return res.status(201).json({ id });
    } catch (err) {
      // The UNIQUE constraint on path is the expected failure here.
      logger.warn({ err, projectId }, "project path link rejected");
      return res.status(409).json({ error: "That path is already linked to a project" });
    }
  });

  /** DELETE /api/ingest/paths/:id */
  router.delete("/api/ingest/paths/:id", (req, res) => {
    const removed = unlinkProjectPath(db, req.params.id);
    if (!removed) return res.status(404).json({ error: "Path link not found" });
    broadcast({ type: "project_path_unlinked", payload: { id: req.params.id } });
    return res.status(204).end();
  });

  return router;
};
```

- [ ] **Step 4: Add the three WebSocket event types**

In `shared/types.ts`, extend the `WsEventType` union by replacing the final line `  | "worktree_updated";` with:

```ts
  | "worktree_updated"
  | "cost_ingested"
  | "project_path_linked"
  | "project_path_unlinked";
```

Then extend the `WsEvent` union by replacing its final line `  | WsEventOf<"worktree_updated", TaskWorktree>;` with:

```ts
  | WsEventOf<"worktree_updated", TaskWorktree>
  | WsEventOf<"cost_ingested", { filesScanned: number; recordsIngested: number; recordsSkipped: number; unpriced: number; unattributed: number }>
  | WsEventOf<"project_path_linked", { id: string; project_id: string }>
  | WsEventOf<"project_path_unlinked", { id: string }>;
```

The `cost_ingested` payload is structurally the `SyncResult` from `server/ingest/transcripts/types.ts`. It is spelled out inline rather than imported because `shared/types.ts` is the single source of truth shared with the client and must not depend on a server-only module.

- [ ] **Step 5: Register the route factory**

In `server/routes/index.ts`, add the import beside the others:

```ts
import { ingestRoutes } from "./ingest.js";
```

and add `ingestRoutes,` to the end of the `routeFactories` array.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/ingest-routes.test.ts && npm run typecheck:all`
Expected: PASS, 5 tests, typecheck clean.

- [ ] **Step 7: Kick off a background scan at startup**

In `server/index.ts`, add the import beside the others:

```ts
import { syncTranscripts } from "./ingest/transcripts/sync.js";
```

and inside the `server.listen(PORT, () => { ... })` callback, after the existing `backfillMilestoneDailyStats` block, add:

```ts
  // Backgrounded deliberately: the first run on a machine with a long Claude
  // Code history walks every transcript, and that must never delay the server
  // becoming available. A failure here is logged and otherwise ignored, exactly
  // like the backfill above: cost ingestion is best-effort and never degrades
  // the running server.
  syncTranscripts(db)
    .then((result) => {
      if (result.recordsIngested > 0) {
        logger.info(result, "Ingested Claude Code transcript usage");
      }
    })
    .catch((err) => logger.warn({ err }, "transcript ingestion failed — continuing"));
```

- [ ] **Step 8: Add the periodic incremental scan**

Startup and the manual endpoint alone would leave the dashboard stale while an
agent is actively working. Add this immediately after the startup scan, still
inside the `server.listen` callback:

```ts
  // A steady-state pass costs time proportional to new bytes, not to the number
  // of transcripts on disk, because each file resumes from its recorded byte
  // offset. unref() keeps this timer from holding the process open, so the
  // server still exits cleanly on SIGINT.
  const INGEST_INTERVAL_MS = 60_000;
  const ingestTimer = setInterval(() => {
    syncTranscripts(db).catch((err) => logger.warn({ err }, "periodic transcript scan failed"));
  }, INGEST_INTERVAL_MS);
  ingestTimer.unref();
```

- [ ] **Step 9: Verify the timer does not keep the process alive**

This is the one failure mode of the step above that a unit test will not catch,
and it would make `npm start` impossible to Ctrl-C cleanly.

Run: `npm run build:client && timeout 15 npx tsx server/index.ts; echo "exit=$?"`

Expected: the server logs `Vibe Dash running`, then `timeout` terminates it. If
the process instead hangs past the timeout, `unref()` is missing or was applied
to the wrong handle.

- [ ] **Step 10: Verify the whole suite and commit**

Run: `npm test && npm run typecheck:all && npm run lint`
Expected: PASS.

```bash
git add server/routes/ingest.ts server/routes/index.ts server/index.ts shared/types.ts tests/ingest-routes.test.ts
git commit -m "feat(ingest): expose scan/status routes and scan at startup"
```

---

### Task 7: Documentation and canon

No code. This task exists because shipping the feature while the documentation argues against it is how the plugin subsystem survived for months after the README declared it removed.

**Files:**
- Create: `docs/ingestion.md`
- Modify: `README.md` (delete the log-scraping disclaimer; revise the cost bullet; document `VIBE_DASH_CLAUDE_HOME`)
- Modify: `docs/decisions/2026-05-strategic-positioning.md` (mark superseded)
- Create: `docs/decisions/2026-08-09-used-oss-project.md`
- Modify: `docs/integrations/claude-code.md` (stop telling Claude Code agents to call `log_cost`)

- [ ] **Step 1: Delete the contradicting README bullet**

In `README.md`, under *What Vibe Dash is not*, delete this bullet entirely:

```
- **Passive cross-platform ingestion** (webhooks, log scraping) — agents report over MCP, not by POSTing to an ingest endpoint. That ingestion path was removed as dead code.
```

Reading transcripts is log scraping. Leaving that line in would have the README argue against the product.

- [ ] **Step 2: Revise the README cost bullet**

Replace the cost bullet and the reporting note (added in PR #172) with:

```markdown
- **Cost tracker**: per-agent and per-model token spend, read directly from Claude Code's local session transcripts

> **How reporting works:** cost and token figures for Claude Code are read from
> its own transcripts on disk, so they are correct whether or not an agent
> remembered to report anything. Task status is different: that still arrives
> because an agent chose to call an MCP tool, so a task nobody updates stays
> stale. Agents other than Claude Code report cost through the `log_cost` tool.
> See [docs/ingestion.md](docs/ingestion.md) for exactly what is read and what
> is not.
```

- [ ] **Step 3: Add `VIBE_DASH_CLAUDE_HOME` to the README configuration table**

```markdown
| `VIBE_DASH_CLAUDE_HOME` | `~/.claude/projects` | Where to look for Claude Code session transcripts. Point this elsewhere if your Claude Code install keeps them somewhere else, or at an empty directory to switch ingestion off. |
```

- [ ] **Step 4: Write `docs/ingestion.md`**

It must answer four questions plainly, because a feature that claims trustworthiness owes the reader a precise account of what it does and does not know:

1. **What is read.** `~/.claude/projects/**/*.jsonl`, and only these fields: `usage`, `model`, `cwd`, `sessionId`, `uuid`, `timestamp`, `gitBranch`, `isSidechain`. State explicitly that **prompt and response content are never read into the database**.
2. **What is derived.** Cost, from a static rate table with a review date. Include the Sonnet 5 introductory-pricing limitation verbatim from `pricing.ts`.
3. **What is inferred, and how conservatively.** Project attribution by directory link only. Unmatched spend shows as Unattributed. Nothing is auto-linked.
4. **What it does not know.** Which task the spend belongs to. Non-Claude-Code agents. Anything after a transcript-format change, which surfaces as a rising skipped-line count in `GET /api/ingest/status`.

- [ ] **Step 5: Record the positioning change**

Create `docs/decisions/2026-08-09-used-oss-project.md` recording decision D1 and D2 from the spec, with the rejected alternatives. Then add this line under the `**Status:**` heading of `docs/decisions/2026-05-strategic-positioning.md`:

```markdown
> **Superseded 2026-08-09** by [2026-08-09-used-oss-project.md](2026-08-09-used-oss-project.md).
> The "portfolio piece" scope cap, and its "does this only matter to a paying
> customer?" test, no longer apply. This file is kept for the reasoning that led
> to the original decision.
```

- [ ] **Step 6: Update the Claude Code integration guide**

In `docs/integrations/claude-code.md`, remove any instruction telling the agent to call `log_cost`, and add a one-line note that Claude Code cost is read from transcripts automatically. Leave the `log_cost` instruction in place in the other four integration guides, whose agents cannot be observed.

- [ ] **Step 7: Update the two out-of-repo canon homes**

These are outside the repository, so they cannot be committed here. Do them, then note them in the PR body:

1. `~/.claude/context/strategy.md`: change the vibe-dash portfolio row from "Active tooling" to reflect the used-OSS-project direction.
2. The memory graph: `add_observations` to the `vibe-dash` entity recording D1 and D2, or a new `vibe-dash--used-oss-project-positioning` entity of type `feedback` linked via `belongs-to`. Do not recreate the existing entity.

- [ ] **Step 8: Verify and commit**

Run: `npm test && npm run lint`
Expected: PASS (docs-only, but the gate runs anyway).

Confirm no document still contradicts the feature:

```bash
grep -rn "log scraping\|logged automatically" README.md docs/
```

Expected: no hits.

```bash
git add README.md docs/
git commit -m "docs(ingest): document transcript ingestion and record the positioning change"
```

---

## Final verification

Before opening the PR, run the `finish-task` skill. Beyond its checklist, confirm the spec's five success criteria:

1. `npm start` on a machine with Claude Code history shows real per-project spend with no configuration.
2. `POST /api/ingest/scan` twice changes no total.
3. Spend from an unlinked directory appears as Unattributed with its path.
4. An unknown model appears as unpriced, not zero.
5. `grep -rn "log scraping" README.md docs/` returns nothing.
