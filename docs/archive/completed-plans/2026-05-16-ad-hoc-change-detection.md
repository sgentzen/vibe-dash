# Ad Hoc Change Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three "tier 3" detectors (unlinked commits, milestone scope changes, activity bursts) that extend the existing `server/detectors/` framework and surface in `HotSpotsView`.

**Architecture:** Add two source-data tables (`commits`, `milestone_history`) via migration 014. Add a small git-log ingestion loop for commits. Hook `updateMilestone` to write history. Implement three detectors following the existing predicate+score pattern. Extend `EntityType` with `commit | milestone | area`. Update `HotSpotsView` icon map.

**Tech Stack:** TypeScript, better-sqlite3, Express, Vitest, React. ESM (`.js` suffixes on relative imports).

**Spec:** [docs/superpowers/specs/2026-05-16-ad-hoc-change-detection-design.md](../../superpowers/specs/2026-05-16-ad-hoc-change-detection-design.md)

**Security note:** All shell-outs in this plan use `child_process.execFile` (via `node:util`'s `promisify`), never the shell-spawning forms. Arguments are passed as an array and never concatenated into a shell string, so user-controlled input cannot be injected.

---

## Task 1: Migration 014 — `commits` and `milestone_history` tables

**Files:**
- Modify: `server/db/migrator.ts` (append to `MIGRATIONS` array, after entry `013_drop_alert_rules` ending at line 493)
- Test: `tests/db-persistence.test.ts` (add one test block, file already exists)

- [ ] **Step 1: Write the failing test**

Add this block to `tests/db-persistence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "./setup.js";

describe("migration 014 — commits + milestone_history", () => {
  it("creates commits and milestone_history tables with expected columns", () => {
    const db = createTestDb();
    const tables = db.pragma("table_list") as { name: string }[];
    expect(tables.some((t) => t.name === "commits")).toBe(true);
    expect(tables.some((t) => t.name === "milestone_history")).toBe(true);

    const commitsCols = (db.pragma("table_info(commits)") as { name: string }[]).map((c) => c.name);
    expect(commitsCols).toEqual(
      expect.arrayContaining(["sha", "subject", "author_email", "authored_at", "ingested_at", "linked_task_id"])
    );

    const histCols = (db.pragma("table_info(milestone_history)") as { name: string }[]).map((c) => c.name);
    expect(histCols).toEqual(
      expect.arrayContaining(["id", "milestone_id", "field", "old_value", "new_value", "changed_at"])
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db-persistence.test.ts`
Expected: FAIL — `commits` / `milestone_history` tables don't exist.

- [ ] **Step 3: Add migration**

In `server/db/migrator.ts`, append a new entry to the `MIGRATIONS` array (insert before the closing `];` at line 494):

```ts
  {
    name: "014_commits_and_milestone_history",
    run(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS commits (
          sha TEXT PRIMARY KEY,
          subject TEXT NOT NULL,
          author_email TEXT,
          authored_at TEXT NOT NULL,
          ingested_at TEXT NOT NULL,
          linked_task_id TEXT REFERENCES tasks(id)
        );
        CREATE INDEX IF NOT EXISTS idx_commits_authored_at ON commits(authored_at);
        CREATE INDEX IF NOT EXISTS idx_commits_linked_task_id ON commits(linked_task_id);

        CREATE TABLE IF NOT EXISTS milestone_history (
          id TEXT PRIMARY KEY,
          milestone_id TEXT NOT NULL REFERENCES milestones(id),
          field TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          changed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_milestone_history_milestone_id ON milestone_history(milestone_id);
        CREATE INDEX IF NOT EXISTS idx_milestone_history_changed_at ON milestone_history(changed_at);
      `);
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db-persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/db/migrator.ts tests/db-persistence.test.ts
git commit -m "feat(db): migration 014 adds commits and milestone_history tables"
```

---

## Task 2: Extend `EntityType` in shared and server types

**Files:**
- Modify: `shared/types.ts` (line 421 — `DetectorEntityType`)
- Modify: `server/detectors/types.ts` (line 8 — `EntityType`)
- Test: `tests/detectors.test.ts` (add a type-level check at end)

- [ ] **Step 1: Write the failing test**

Append to `tests/detectors.test.ts`:

```ts
import type { EntityType } from "../server/detectors/types.js";

describe("EntityType extension", () => {
  it("allows commit, milestone, and area as valid entity types", () => {
    const types: EntityType[] = ["task", "agent", "blocker", "review", "commit", "milestone", "area"];
    expect(types).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/detectors.test.ts`
Expected: FAIL — tsc error / runtime expects 4 entries, not 7.

- [ ] **Step 3: Extend types**

In `server/detectors/types.ts` line 8:

```ts
export type EntityType = "task" | "agent" | "blocker" | "review" | "commit" | "milestone" | "area";
```

In `shared/types.ts` line 421:

```ts
export type DetectorEntityType = "task" | "agent" | "blocker" | "review" | "commit" | "milestone" | "area";
```

- [ ] **Step 4: Run test to verify it passes + typecheck the project**

Run: `npm test -- tests/detectors.test.ts && npm run build`
Expected: PASS and `tsc --noEmit` succeeds.

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts server/detectors/types.ts tests/detectors.test.ts
git commit -m "feat(detectors): extend EntityType with commit, milestone, area"
```

---

## Task 3: `server/db/commits.ts` — CRUD for commits table

**Files:**
- Create: `server/db/commits.ts`
- Modify: `server/db/index.ts` (add re-export line)
- Test: `tests/commits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/commits.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { upsertCommit, listUnlinkedCommitsSince, linkCommitToTask } from "../server/db/commits.js";
import { createProject, createTask } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

describe("commits db helpers", () => {
  it("upsertCommit is idempotent on sha", () => {
    upsertCommit(db, { sha: "abc123", subject: "first", author_email: "a@b", authored_at: "2026-05-01T00:00:00Z" });
    upsertCommit(db, { sha: "abc123", subject: "first-changed", author_email: "a@b", authored_at: "2026-05-01T00:00:00Z" });
    const row = db.prepare("SELECT subject FROM commits WHERE sha = ?").get("abc123") as { subject: string };
    expect(row.subject).toBe("first"); // INSERT OR IGNORE keeps the original
  });

  it("listUnlinkedCommitsSince returns only unlinked commits in range", () => {
    upsertCommit(db, { sha: "old", subject: "old", author_email: null, authored_at: "2026-04-01T00:00:00Z" });
    upsertCommit(db, { sha: "new1", subject: "new1", author_email: null, authored_at: "2026-05-15T00:00:00Z" });
    upsertCommit(db, { sha: "new2", subject: "new2", author_email: null, authored_at: "2026-05-15T00:00:00Z" });

    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    linkCommitToTask(db, "new2", t.id);

    const rows = listUnlinkedCommitsSince(db, "2026-05-01T00:00:00Z");
    expect(rows.map((r) => r.sha)).toEqual(["new1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/commits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/db/commits.ts`**

Create the file:

```ts
import type Database from "better-sqlite3";
import { now } from "./helpers.js";

export interface CommitRow {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
  ingested_at: string;
  linked_task_id: string | null;
}

export interface UpsertCommitInput {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
}

export function upsertCommit(db: Database.Database, input: UpsertCommitInput): void {
  db.prepare(
    `INSERT OR IGNORE INTO commits (sha, subject, author_email, authored_at, ingested_at, linked_task_id)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(input.sha, input.subject, input.author_email, input.authored_at, now());
}

export function linkCommitToTask(db: Database.Database, sha: string, taskId: string): void {
  db.prepare("UPDATE commits SET linked_task_id = ? WHERE sha = ?").run(taskId, sha);
}

export function listUnlinkedCommitsSince(db: Database.Database, isoSince: string): CommitRow[] {
  return db.prepare(
    `SELECT sha, subject, author_email, authored_at, ingested_at, linked_task_id
     FROM commits
     WHERE linked_task_id IS NULL AND authored_at >= ?
     ORDER BY authored_at DESC`
  ).all(isoSince) as CommitRow[];
}

export function latestIngestedAt(db: Database.Database): string | null {
  const row = db.prepare("SELECT MAX(ingested_at) AS m FROM commits").get() as { m: string | null };
  return row.m ?? null;
}
```

- [ ] **Step 4: Re-export from barrel**

Append to `server/db/index.ts`:

```ts
export * from "./commits.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/commits.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db/commits.ts server/db/index.ts tests/commits.test.ts
git commit -m "feat(db): commits table helpers (upsert, link, list-unlinked)"
```

---

## Task 4: `server/db/milestone_history.ts` — CRUD for milestone history

**Files:**
- Create: `server/db/milestone_history.ts`
- Modify: `server/db/index.ts`
- Test: `tests/milestone_history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/milestone_history.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { recordMilestoneChange, listMilestoneHistorySince } from "../server/db/milestone_history.js";
import { createProject, createMilestone } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

describe("milestone_history helpers", () => {
  it("records and lists changes in range", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    recordMilestoneChange(db, m.id, "name", "M", "M2");
    recordMilestoneChange(db, m.id, "target_date", null, "2026-06-01");

    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.field).sort()).toEqual(["name", "target_date"]);
  });

  it("excludes rows before the cutoff", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    db.prepare(
      "INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("h-old", m.id, "name", "a", "b", "2020-01-01T00:00:00Z");
    const rows = listMilestoneHistorySince(db, "2026-01-01T00:00:00Z");
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/milestone_history.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/db/milestone_history.ts`**

```ts
import type Database from "better-sqlite3";
import { genId, now } from "./helpers.js";

export interface MilestoneHistoryRow {
  id: string;
  milestone_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export type WatchedMilestoneField = "name" | "description" | "target_date" | "acceptance_criteria";

export function recordMilestoneChange(
  db: Database.Database,
  milestoneId: string,
  field: WatchedMilestoneField,
  oldValue: string | null,
  newValue: string | null
): void {
  db.prepare(
    `INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(genId(), milestoneId, field, oldValue, newValue, now());
}

export function listMilestoneHistorySince(
  db: Database.Database,
  isoSince: string
): MilestoneHistoryRow[] {
  return db.prepare(
    `SELECT id, milestone_id, field, old_value, new_value, changed_at
     FROM milestone_history
     WHERE changed_at >= ?
     ORDER BY changed_at DESC`
  ).all(isoSince) as MilestoneHistoryRow[];
}
```

- [ ] **Step 4: Re-export from barrel**

Append to `server/db/index.ts`:

```ts
export * from "./milestone_history.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/milestone_history.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db/milestone_history.ts server/db/index.ts tests/milestone_history.test.ts
git commit -m "feat(db): milestone_history helpers"
```

---

## Task 5: Hook `updateMilestone` to record history

**Files:**
- Modify: `server/db/milestones.ts` (`updateMilestone` at line 52)
- Test: `tests/milestone_history.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test**

Append to `tests/milestone_history.test.ts`:

```ts
import { updateMilestone } from "../server/db/index.js";

describe("updateMilestone history hook", () => {
  it("writes a history row when a watched field changes", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "Original" });
    updateMilestone(db, m.id, { name: "Renamed" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "name", old_value: "Original", new_value: "Renamed" });
  });

  it("writes nothing when the new value equals the old", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "Same" });
    updateMilestone(db, m.id, { name: "Same" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(0);
  });

  it("writes one row per changed watched field", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M", description: "old desc" });
    updateMilestone(db, m.id, { name: "M2", description: "new desc", target_date: "2026-06-01" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows.map((r) => r.field).sort()).toEqual(["description", "name", "target_date"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/milestone_history.test.ts`
Expected: FAIL — `listMilestoneHistorySince` returns 0 rows because the hook isn't wired.

- [ ] **Step 3: Modify `updateMilestone`**

Edit `server/db/milestones.ts`. Add an import at the top (alongside existing imports):

```ts
import { recordMilestoneChange, type WatchedMilestoneField } from "./milestone_history.js";
```

Inside `updateMilestone`, immediately after the `if (sets.length === 0) return getMilestone(db, id);` line on line 66, fetch the existing row and diff. Place this block BEFORE the `UPDATE ... RETURNING *` statement so the old values are read before the write:

```ts
  const existing = getMilestone(db, id);
  // No row to compare against — let the UPDATE below run (it will affect 0 rows).
  if (existing) {
    const watched: WatchedMilestoneField[] = ["name", "description", "target_date", "acceptance_criteria"];
    for (const field of watched) {
      if (input[field] === undefined) continue;
      const oldVal = (existing as unknown as Record<string, string | null>)[field] ?? null;
      const newVal = input[field] ?? null;
      if (oldVal !== newVal) {
        recordMilestoneChange(db, id, field, oldVal, newVal);
      }
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/milestone_history.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/db/milestones.ts tests/milestone_history.test.ts
git commit -m "feat(milestones): record watched-field changes to milestone_history"
```

---

## Task 6: `server/ingestion/gitLog.ts` — stubbable git wrapper

**Files:**
- Create: `server/ingestion/gitLog.ts`
- Test: `tests/git-log-wrapper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/git-log-wrapper.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseGitLogOutput } from "../server/ingestion/gitLog.js";

describe("parseGitLogOutput", () => {
  it("parses space-delimited git log output", () => {
    const raw = [
      "abc1234567890 feat: add foo alice@example.com 2026-05-15T10:00:00+00:00",
      "def1234567890 fix: bar bob@example.com 2026-05-15T11:00:00+00:00",
    ].join("\n");
    const rows = parseGitLogOutput(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sha: "abc1234567890", authored_at: "2026-05-15T10:00:00+00:00" });
  });

  it("returns empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("\n")).toEqual([]);
  });
});
```

NOTE: parser uses NUL-byte (`\x00`) as field delimiter — see implementation. The test above uses space-joined fixture for readability; the implementation must support both via the format string. Use this updated test that uses NUL bytes to match the actual git output:

```ts
import { describe, it, expect } from "vitest";
import { parseGitLogOutput } from "../server/ingestion/gitLog.js";

describe("parseGitLogOutput", () => {
  it("parses NUL-delimited git log output", () => {
    const NUL = "\x00";
    const raw = [
      ["abc1234567890", "feat: add foo", "alice@example.com", "2026-05-15T10:00:00+00:00"].join(NUL),
      ["def1234567890", "fix: bar", "bob@example.com", "2026-05-15T11:00:00+00:00"].join(NUL),
    ].join("\n");
    const rows = parseGitLogOutput(raw);
    expect(rows).toEqual([
      { sha: "abc1234567890", subject: "feat: add foo", author_email: "alice@example.com", authored_at: "2026-05-15T10:00:00+00:00" },
      { sha: "def1234567890", subject: "fix: bar", author_email: "bob@example.com", authored_at: "2026-05-15T11:00:00+00:00" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("\n")).toEqual([]);
  });

  it("treats empty author_email as null", () => {
    const NUL = "\x00";
    const raw = ["abc", "subj", "", "2026-05-15T10:00:00Z"].join(NUL);
    expect(parseGitLogOutput(raw)[0].author_email).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/git-log-wrapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/ingestion/gitLog.ts`**

Uses `execFile` (the safe form, no shell). All arguments are passed as an array, never concatenated into a shell string.

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runGit = promisify(execFile);

export interface RawCommit {
  sha: string;
  subject: string;
  author_email: string | null;
  authored_at: string;
}

const GIT_LOG_FORMAT = "%H%x00%s%x00%ae%x00%aI";
const NUL = "\x00";

export function parseGitLogOutput(raw: string): RawCommit[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, subject, author_email, authored_at] = line.split(NUL);
      return {
        sha,
        subject,
        author_email: author_email === "" ? null : author_email,
        authored_at,
      };
    });
}

export type GitLogFn = (sinceIso: string, repoPath: string) => Promise<RawCommit[]>;

// Default implementation — invokes `git log` via execFile (no shell).
export const realGitLog: GitLogFn = async (sinceIso, repoPath) => {
  const { stdout } = await runGit(
    "git",
    ["log", `--since=${sinceIso}`, `--format=${GIT_LOG_FORMAT}`],
    { cwd: repoPath, maxBuffer: 50 * 1024 * 1024 }
  );
  return parseGitLogOutput(stdout);
};

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await runGit("git", ["rev-parse", "--git-dir"], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/git-log-wrapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ingestion/gitLog.ts tests/git-log-wrapper.test.ts
git commit -m "feat(ingestion): git log wrapper with parser"
```

---

## Task 7: `server/ingestion/commits.ts` — ingestion runner

**Files:**
- Create: `server/ingestion/commits.ts`
- Test: `tests/ingestion-commits.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ingestion-commits.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runCommitIngestionOnce } from "../server/ingestion/commits.js";
import { createProject, createTask } from "../server/db/index.js";
import type { GitLogFn, RawCommit } from "../server/ingestion/gitLog.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

function stubLog(commits: RawCommit[]): GitLogFn {
  return async () => commits;
}

describe("runCommitIngestionOnce", () => {
  it("upserts commits and is idempotent on re-run", async () => {
    const gitLog = stubLog([
      { sha: "aaa", subject: "feat: thing", author_email: "a@b", authored_at: "2026-05-15T10:00:00Z" },
      { sha: "bbb", subject: "fix: other", author_email: "a@b", authored_at: "2026-05-15T11:00:00Z" },
    ]);
    const r1 = await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });
    expect(r1.inserted).toBe(2);
    const r2 = await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });
    expect(r2.inserted).toBe(0);
  });

  it("links commits whose subject contains a known task id", async () => {
    const p = createProject(db, { name: "P", description: null });
    const t = createTask(db, { project_id: p.id, title: "T", description: null, priority: "medium" });
    const gitLog = stubLog([
      { sha: "ccc", subject: `feat: closes ${t.id}`, author_email: null, authored_at: "2026-05-15T10:00:00Z" },
      { sha: "ddd", subject: "feat: unrelated", author_email: null, authored_at: "2026-05-15T11:00:00Z" },
    ]);
    await runCommitIngestionOnce(db, { gitLog, repoPath: "/tmp", lookbackDays: 7 });

    const linked = db.prepare("SELECT linked_task_id FROM commits WHERE sha = ?").get("ccc") as { linked_task_id: string };
    expect(linked.linked_task_id).toBe(t.id);
    const unlinked = db.prepare("SELECT linked_task_id FROM commits WHERE sha = ?").get("ddd") as { linked_task_id: string | null };
    expect(unlinked.linked_task_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ingestion-commits.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/ingestion/commits.ts`**

```ts
import type Database from "better-sqlite3";
import { upsertCommit, linkCommitToTask } from "../db/commits.js";
import type { GitLogFn } from "./gitLog.js";

export interface RunCommitIngestionOptions {
  gitLog: GitLogFn;
  repoPath: string;
  lookbackDays: number;
}

export interface CommitIngestionResult {
  inserted: number;
  linked: number;
}

export async function runCommitIngestionOnce(
  db: Database.Database,
  opts: RunCommitIngestionOptions
): Promise<CommitIngestionResult> {
  const sinceMs = Date.now() - opts.lookbackDays * 86_400_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const commits = await opts.gitLog(sinceIso, opts.repoPath);

  // Snapshot known shas to compute `inserted` after the loop (INSERT OR IGNORE doesn't tell us).
  const knownBefore = new Set<string>(
    (db.prepare("SELECT sha FROM commits").all() as { sha: string }[]).map((r) => r.sha)
  );

  // Snapshot known task ids for subject matching.
  const taskIds = (db.prepare("SELECT id FROM tasks").all() as { id: string }[]).map((r) => r.id);

  let linked = 0;
  for (const c of commits) {
    upsertCommit(db, c);
    if (knownBefore.has(c.sha)) continue;
    const match = taskIds.find((id) => c.subject.includes(id));
    if (match) {
      linkCommitToTask(db, c.sha, match);
      linked++;
    }
  }

  const knownAfter = (db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number }).n;
  const inserted = knownAfter - knownBefore.size;
  return { inserted, linked };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ingestion-commits.test.ts`
Expected: PASS (both blocks).

- [ ] **Step 5: Commit**

```bash
git add server/ingestion/commits.ts tests/ingestion-commits.test.ts
git commit -m "feat(ingestion): commit ingestion runner with task linking"
```

---

## Task 8: Detector — `unlinked-commit`

**Files:**
- Create: `server/detectors/tier3.ts`
- Test: `tests/detectors-tier3.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/detectors-tier3.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { runDetectors, _resetRegistry } from "../server/detectors/registry.js";
import { registerTier3Detectors } from "../server/detectors/tier3.js";
import { upsertCommit } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _resetRegistry();
  registerTier3Detectors();
});

afterEach(() => { _resetRegistry(); });

describe("unlinked-commit detector", () => {
  it("emits one match per unlinked commit in the last 7 days", () => {
    upsertCommit(db, { sha: "recent", subject: "drive-by fix", author_email: "a@b", authored_at: new Date().toISOString() });
    upsertCommit(db, { sha: "old", subject: "old fix", author_email: "a@b", authored_at: new Date(Date.now() - 30 * 86_400_000).toISOString() });
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "unlinked-commit");
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ entityId: "recent", entityType: "commit", score: 60, category: "change" });
  });

  it("ignores linked commits", () => {
    upsertCommit(db, { sha: "linked", subject: "feat: with id", author_email: null, authored_at: new Date().toISOString() });
    db.prepare("UPDATE commits SET linked_task_id = 'fake-task-id' WHERE sha = ?").run("linked");
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "unlinked-commit");
    expect(matches).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: FAIL — `server/detectors/tier3.ts` not found.

- [ ] **Step 3: Implement detector**

Create `server/detectors/tier3.ts`:

```ts
import { registerDetector } from "./registry.js";
import type { DetectorContext, Match } from "./types.js";

// ─── unlinked-commit ──────────────────────────────────────────────────────────

interface CommitMatchRow {
  sha: string;
  subject: string;
  author_email: string | null;
}

function unlinkedCommitPredicate({ db, now }: DetectorContext): Match[] {
  const since = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT sha, subject, author_email
     FROM commits
     WHERE linked_task_id IS NULL AND authored_at >= ?`
  ).all(since) as CommitMatchRow[];
  return rows.map((r) => ({
    entityId: r.sha,
    entityType: "commit" as const,
    label: "Unlinked commit",
    detail: r.author_email ? `${r.subject} · ${r.author_email}` : r.subject,
  }));
}

export function registerTier3Detectors(): void {
  registerDetector({
    id: "unlinked-commit",
    category: "change",
    defaultThreshold: 50,
    predicate: unlinkedCommitPredicate,
    score: () => 60,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/detectors/tier3.ts tests/detectors-tier3.test.ts
git commit -m "feat(detectors): tier 3 — unlinked-commit"
```

---

## Task 9: Detector — `scope-change`

**Files:**
- Modify: `server/detectors/tier3.ts`
- Test: `tests/detectors-tier3.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/detectors-tier3.test.ts`:

```ts
import { createProject, createMilestone, updateMilestone } from "../server/db/index.js";

describe("scope-change detector", () => {
  it("emits 90 for name, 80 for target_date, 60 for description", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M", description: "d" });
    updateMilestone(db, m.id, { name: "M2" });
    updateMilestone(db, m.id, { target_date: "2026-06-01" });
    updateMilestone(db, m.id, { description: "d2" });

    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    const byScore = matches.map((x) => x.score).sort();
    expect(byScore).toEqual([60, 80, 90]);
  });

  it("excludes changes older than 30 days", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    db.prepare(
      "INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("h-old", m.id, "name", "a", "b", new Date(Date.now() - 40 * 86_400_000).toISOString());
    const matches = runDetectors(db, { minScore: 0 }).filter((x) => x.detectorId === "scope-change");
    expect(matches).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: FAIL — `scope-change` detector not registered.

- [ ] **Step 3: Add detector**

Edit `server/detectors/tier3.ts`. Add interfaces, predicate, and score above `registerTier3Detectors`:

```ts
// ─── scope-change ─────────────────────────────────────────────────────────────

interface HistoryMatchRow {
  id: string;
  milestone_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  milestone_name: string | null;
}

function truncate(s: string | null, n: number): string {
  if (s === null) return "∅";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function scopeChangePredicate({ db, now }: DetectorContext): Match[] {
  const since = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT h.id, h.milestone_id, h.field, h.old_value, h.new_value, m.name AS milestone_name
     FROM milestone_history h
     LEFT JOIN milestones m ON h.milestone_id = m.id
     WHERE h.changed_at >= ?`
  ).all(since) as HistoryMatchRow[];

  return rows.map((r) => ({
    entityId: r.id,
    entityType: "milestone" as const,
    label: `Milestone ${r.milestone_name ?? "?"} ${r.field} changed`,
    detail: `${truncate(r.old_value, 80)} → ${truncate(r.new_value, 80)}`,
  }));
}

function scopeChangeScore(match: Match, { db }: DetectorContext): number {
  const row = db.prepare("SELECT field FROM milestone_history WHERE id = ?").get(match.entityId) as { field: string } | undefined;
  if (!row) return 0;
  switch (row.field) {
    case "name": return 90;
    case "target_date": return 80;
    case "description":
    case "acceptance_criteria": return 60;
    default: return 50;
  }
}
```

Then update the registration block:

```ts
export function registerTier3Detectors(): void {
  registerDetector({
    id: "unlinked-commit",
    category: "change",
    defaultThreshold: 50,
    predicate: unlinkedCommitPredicate,
    score: () => 60,
  });
  registerDetector({
    id: "scope-change",
    category: "change",
    defaultThreshold: 50,
    predicate: scopeChangePredicate,
    score: scopeChangeScore,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: PASS (both blocks).

- [ ] **Step 5: Commit**

```bash
git add server/detectors/tier3.ts tests/detectors-tier3.test.ts
git commit -m "feat(detectors): tier 3 — scope-change"
```

---

## Task 10: Detector — `activity-burst`

**Files:**
- Modify: `server/detectors/tier3.ts`
- Test: `tests/detectors-tier3.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/detectors-tier3.test.ts`:

```ts
describe("activity-burst detector", () => {
  it("emits when current-window count exceeds baseline × 3 and is ≥ 5", () => {
    const p = createProject(db, { name: "Bursty", description: null });
    const t = db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at) VALUES (?, ?, ?, 'planned', 'medium', 0, ?, ?) RETURNING *"
    ).get("task-1", p.id, "T", new Date().toISOString(), new Date().toISOString()) as { id: string };

    // 6 recent activity rows in the last 60 minutes (current window)
    for (let i = 0; i < 6; i++) {
      const ts = new Date(Date.now() - i * 60_000).toISOString();
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`a-${i}`, t.id, `msg ${i}`, ts);
    }
    // baseline: 7 historical rows spread one per day across 7 days
    for (let d = 1; d <= 7; d++) {
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`b-${d}`, t.id, `baseline ${d}`, new Date(Date.now() - d * 86_400_000).toISOString());
    }

    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "activity-burst");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityType).toBe("area");
    expect(matches[0].entityId).toBe(p.id);
  });

  it("suppresses bursts with current count < 5", () => {
    const p = createProject(db, { name: "Quiet", description: null });
    const t = db.prepare(
      "INSERT INTO tasks (id, project_id, title, status, priority, progress, created_at, updated_at) VALUES (?, ?, ?, 'planned', 'medium', 0, ?, ?) RETURNING *"
    ).get("task-2", p.id, "T", new Date().toISOString(), new Date().toISOString()) as { id: string };
    for (let i = 0; i < 4; i++) {
      db.prepare(
        "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp, source) VALUES (?, ?, NULL, ?, ?, 'test')"
      ).run(`q-${i}`, t.id, "m", new Date(Date.now() - i * 60_000).toISOString());
    }
    const matches = runDetectors(db, { minScore: 0 }).filter((m) => m.detectorId === "activity-burst");
    expect(matches).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: FAIL — `activity-burst` detector not registered.

- [ ] **Step 3: Add detector**

Edit `server/detectors/tier3.ts`. Add module-level constants under the existing imports, then add the predicate and score functions:

```ts
// ─── activity-burst ───────────────────────────────────────────────────────────

const BURST_WINDOW_MIN = Number(process.env.DETECTOR_BURST_WINDOW_MIN ?? 60);
const BURST_THRESHOLD = Number(process.env.DETECTOR_BURST_THRESHOLD ?? 3.0);
const BURST_MIN_COUNT = 5;
const BURST_BASELINE_DAYS = 7;

interface BurstRow {
  project_id: string;
  project_name: string | null;
  current_count: number;
  baseline_count: number;
}

function activityBurstPredicate({ db, now }: DetectorContext): Match[] {
  const nowMs = new Date(now).getTime();
  const currentSince = new Date(nowMs - BURST_WINDOW_MIN * 60_000).toISOString();
  const baselineSince = new Date(nowMs - BURST_BASELINE_DAYS * 86_400_000).toISOString();

  const rows = db.prepare(
    `SELECT t.project_id AS project_id,
            p.name AS project_name,
            SUM(CASE WHEN a.timestamp >= ? THEN 1 ELSE 0 END) AS current_count,
            SUM(CASE WHEN a.timestamp >= ? AND a.timestamp < ? THEN 1 ELSE 0 END) AS baseline_count
     FROM activity_log a
     JOIN tasks t ON a.task_id = t.id
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE a.timestamp >= ?
     GROUP BY t.project_id`
  ).all(currentSince, baselineSince, currentSince, baselineSince) as BurstRow[];

  return rows
    .filter((r) => {
      if (r.current_count < BURST_MIN_COUNT) return false;
      const slots = (BURST_BASELINE_DAYS * 1440) / BURST_WINDOW_MIN;
      const baselinePerSlot = r.baseline_count / slots;
      const denom = baselinePerSlot < 1 ? 1 : baselinePerSlot;
      const ratio = r.current_count / denom;
      return ratio >= BURST_THRESHOLD;
    })
    .map((r) => ({
      entityId: r.project_id,
      entityType: "area" as const,
      label: `Activity burst in ${r.project_name ?? r.project_id}`,
      detail: `${r.current_count} events in ${BURST_WINDOW_MIN}m, baseline ${r.baseline_count} over ${BURST_BASELINE_DAYS}d`,
    }));
}

function activityBurstScore(match: Match, { db, now }: DetectorContext): number {
  const nowMs = new Date(now).getTime();
  const currentSince = new Date(nowMs - BURST_WINDOW_MIN * 60_000).toISOString();
  const baselineSince = new Date(nowMs - BURST_BASELINE_DAYS * 86_400_000).toISOString();
  const row = db.prepare(
    `SELECT SUM(CASE WHEN a.timestamp >= ? THEN 1 ELSE 0 END) AS cur,
            SUM(CASE WHEN a.timestamp >= ? AND a.timestamp < ? THEN 1 ELSE 0 END) AS base
     FROM activity_log a JOIN tasks t ON a.task_id = t.id
     WHERE t.project_id = ? AND a.timestamp >= ?`
  ).get(currentSince, baselineSince, currentSince, match.entityId, baselineSince) as { cur: number; base: number };
  const slots = (BURST_BASELINE_DAYS * 1440) / BURST_WINDOW_MIN;
  const perSlot = row.base / slots;
  const denom = perSlot < 1 ? 1 : perSlot;
  const ratio = row.cur / denom;
  if (ratio >= 10) return 95;
  if (ratio >= 5) return 80;
  return 65;
}
```

Update registration:

```ts
export function registerTier3Detectors(): void {
  registerDetector({ id: "unlinked-commit", category: "change", defaultThreshold: 50, predicate: unlinkedCommitPredicate, score: () => 60 });
  registerDetector({ id: "scope-change", category: "change", defaultThreshold: 50, predicate: scopeChangePredicate, score: scopeChangeScore });
  registerDetector({ id: "activity-burst", category: "change", defaultThreshold: 60, predicate: activityBurstPredicate, score: activityBurstScore });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/detectors-tier3.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/detectors/tier3.ts tests/detectors-tier3.test.ts
git commit -m "feat(detectors): tier 3 — activity-burst with project bucketing"
```

---

## Task 11: Export `registerTier3Detectors` from barrel

**Files:**
- Modify: `server/detectors/index.ts`

- [ ] **Step 1: Update barrel exports**

Edit `server/detectors/index.ts`. The file currently is:

```ts
export type { Detector, DetectorContext, Match, ScoredMatch, EntityType } from "./types.js";
export { registerDetector, listDetectors, runDetectors } from "./registry.js";
export type { RunOptions } from "./registry.js";
export { registerTier1Detectors } from "./tier1.js";
```

Add the tier-3 export:

```ts
export { registerTier3Detectors } from "./tier3.js";
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add server/detectors/index.ts
git commit -m "chore(detectors): re-export registerTier3Detectors from barrel"
```

---

## Task 12: Wire startup — register tier 3 + start commit ingestion loop

**Files:**
- Modify: `server/index.ts`
- Test: manual smoke check (no automated test — this is wiring)

- [ ] **Step 1: Read current startup file to find registration site**

Use Grep against `server/index.ts` for `registerTier1Detectors`, `listen`, `createServer` to locate the registration site and the post-listen area where periodic startups live.

- [ ] **Step 2: Add tier 3 registration immediately after `registerTier1Detectors()`**

Add the new call:

```ts
registerTier1Detectors();
registerTier3Detectors();
```

Update the import line that brings in `registerTier1Detectors`:

```ts
import { registerTier1Detectors, registerTier3Detectors } from "./detectors/index.js";
```

- [ ] **Step 3: Add ingestion loop after the server starts listening**

Add these constants near the top of `server/index.ts` (with other env var reads):

```ts
const COMMIT_INGEST_ENABLED = process.env.COMMIT_INGEST_ENABLED !== "false";
const COMMIT_INGEST_INTERVAL_MS = Number(process.env.COMMIT_INGEST_INTERVAL_MS ?? 300_000);
const GIT_REPO_PATH = process.env.GIT_REPO_PATH ?? process.cwd();
```

Add imports:

```ts
import { runCommitIngestionOnce } from "./ingestion/commits.js";
import { realGitLog, isGitRepo } from "./ingestion/gitLog.js";
```

Add the startup block (place after the server `listen()` call, alongside other periodic startups):

```ts
async function startCommitIngestion(): Promise<void> {
  if (!COMMIT_INGEST_ENABLED) return;
  if (!(await isGitRepo(GIT_REPO_PATH))) {
    console.warn(`[commit-ingest] ${GIT_REPO_PATH} is not a git repo — disabling`);
    return;
  }
  const tick = async (): Promise<void> => {
    try {
      const r = await runCommitIngestionOnce(db, { gitLog: realGitLog, repoPath: GIT_REPO_PATH, lookbackDays: 7 });
      if (r.inserted > 0 || r.linked > 0) {
        console.log(`[commit-ingest] inserted=${r.inserted} linked=${r.linked}`);
      }
    } catch (err) {
      console.warn(`[commit-ingest] tick failed:`, err);
    }
  };
  void tick(); // initial backfill
  setInterval(() => { void tick(); }, COMMIT_INGEST_INTERVAL_MS);
}
void startCommitIngestion();
```

Note: `db` is the existing Database instance opened earlier in `server/index.ts`. Don't introduce a new one.

- [ ] **Step 4: Build + manual smoke**

Run: `npm run build`
Expected: PASS.

Then start the server:

Run: `npm run dev:server`
Expected: server starts on port 3001. After ~5 seconds (initial tick), check that the `commits` table has rows (if any commits exist in last 7 days in the repo):

Run: `sqlite3 vibe-dash.db "SELECT COUNT(*) FROM commits;"`
Expected: a positive integer (or 0 if no commits in the last 7 days).

Stop the dev server.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): register tier3 detectors + start commit ingestion loop"
```

---

## Task 13: HotSpotsView — icons for new entity types

**Files:**
- Modify: `src/components/HotSpotsView.tsx` (line 28 — `entityIcon`)

- [ ] **Step 1: Add icon cases**

Replace the `entityIcon` function (lines 28-36) with:

```ts
function entityIcon(entityType: ScoredMatch["entityType"]): string {
  switch (entityType) {
    case "blocker":   return "⊘";
    case "agent":     return "◉";
    case "review":    return "✗";
    case "task":      return "□";
    case "commit":    return "◇";
    case "milestone": return "⤳";
    case "area":      return "⚡";
    default:          return "·";
  }
}
```

- [ ] **Step 2: Build to confirm types align**

Run: `npm run build`
Expected: PASS — `shared/types.ts` `DetectorEntityType` already includes the new values from Task 2, so the switch's `default` is structurally unreachable but kept for safety.

- [ ] **Step 3: Manual UI smoke**

Start the dev server (`npm run dev`) and open `http://localhost:3000`. Navigate to HotSpots. If there are no tier-3 matches yet, you can seed one in the DB:

```bash
sqlite3 vibe-dash.db "INSERT INTO commits (sha, subject, author_email, authored_at, ingested_at, linked_task_id) VALUES ('seed-sha', 'Manual seed for UI smoke', 'me@local', datetime('now'), datetime('now'), NULL);"
```

Refresh HotSpots — you should see "Unlinked commit" with the ◇ icon. Remove the seed row after:

```bash
sqlite3 vibe-dash.db "DELETE FROM commits WHERE sha = 'seed-sha';"
```

- [ ] **Step 4: Commit**

```bash
git add src/components/HotSpotsView.tsx
git commit -m "feat(ui): HotSpotsView icons for commit, milestone, area"
```

---

## Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: vite build + tsc both succeed.

- [ ] **Step 3: Code review**

Per `CLAUDE.md` task completion protocol — invoke `superpowers:requesting-code-review` against the branch's diff. Address any high-confidence issues. Touch the marker:

```bash
mkdir -p .claude && touch .claude/.last-code-review
```

- [ ] **Step 4: Update vibe-dash task tracking** if a corresponding task exists.

---

## Self-review notes (author)

- **Spec coverage:** all three detectors + their data sources + UI + scheduler each have a task. ✓
- **No placeholders:** every step has concrete code or commands. ✓
- **Type consistency:** `Match.entityType` values match across `EntityType` in `types.ts`, `DetectorEntityType` in `shared/types.ts`, and the icon switch. Function names (`upsertCommit`, `linkCommitToTask`, `listUnlinkedCommitsSince`, `recordMilestoneChange`, `listMilestoneHistorySince`, `runCommitIngestionOnce`, `registerTier3Detectors`) consistent across all tasks. ✓
- **Security:** all shell-outs use `execFile` (no shell) with array arguments — no concatenation of user input into command strings. ✓
- **Known caveat:** Task 5's `getMilestone` is referenced but already imported (it's used on line 66 of the original file), so no new import needed beyond `recordMilestoneChange`.
