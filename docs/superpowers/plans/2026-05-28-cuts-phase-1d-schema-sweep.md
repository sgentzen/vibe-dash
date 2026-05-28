# Vibe-Dash Phase 1D: Schema Sweep (Drop Orphan Tables + Column)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the 9 orphan tables and 1 orphan column left behind by Phases 1A–1C, plus remove the last bits of code that still reference orphan schema. Net: a clean schema with no dead tables, and removal of a dead `unauthorized()` helper.

**Architecture:** Two coordinated tasks in one PR. **Task 1** removes all CODE that touches orphan schema (a still-live `milestone_history` writer, dead `recurrence_rule` data-layer references, the dead `unauthorized()` helper) and fixes affected tests — leaving the orphan tables present-but-unreferenced (a valid intermediate state). **Task 2** adds migration `015` that drops the 9 tables + the `recurrence_rule` column, and adds a verification test. Order matters: the code must stop referencing the column/table BEFORE the migration drops them, or task-create / milestone-update would throw at runtime. Task 1 lands first.

**Tech Stack:** TypeScript 6, better-sqlite3 12.8 (SQLite **3.51.3** — supports native `ALTER TABLE ... DROP COLUMN`), Express 5, Vitest. PowerShell 5.1 default.

**Branch baseline:** Assumes Phase 1C (#107) merged into `main`. If not yet merged, branch from `cuts/phase-1c` HEAD. The dossier was generated against `cuts/phase-1c`.

**Key facts (from inspection):**
- Migrations live in `server/db/migrator.ts` as a `MIGRATIONS: Migration[]` array; each entry is `{ name: string, run(db): void }`. Tracked in a `_migrations` table by `name`. Only un-run migrations execute, each wrapped in a transaction. **Highest is `014_commits_and_milestone_history`** → new one is `015`. The array closes with `];` at the end (currently line ~522).
- `PRAGMA foreign_keys = ON` is set (`server/db/schema.ts`). All 9 orphan tables have only **outbound** FKs to kept tables (e.g. `task_reviews.task_id → tasks`) and **zero inbound** FKs from kept tables, so every `DROP TABLE` succeeds. Inter-orphan references (`git_linked_items.integration_id`, `ingestion_events.source_id`) are bare TEXT (no FK), so drop order is irrelevant. `DROP TABLE IF EXISTS` is used for safety.
- SQLite does NOT support `DROP COLUMN IF EXISTS`. Use plain `ALTER TABLE tasks DROP COLUMN recurrence_rule;` — safe because the migration runs exactly once (tracked), and on a fresh DB the column exists (created by migration 001/002) before 015 runs. No index/trigger/view references `recurrence_rule`, so the drop is unobstructed.

**The 9 orphan tables + 1 column:**
| Table | Created in | Has live code touching it? |
|---|---|---|
| `task_reviews` | 001 | No (Phase 1A) |
| `webhooks` | 001 | No (Phase 1B) |
| `git_integrations` | 005 | No (Phase 1B) |
| `git_linked_items` | 005 | No (Phase 1B) |
| `ingestion_sources` | 005 | No (Phase 1C) |
| `ingestion_events` | 005 | No (Phase 1C) |
| `users` | 006 | No (Phase 1C) |
| `commits` | 014 | No (Phase 1B) |
| `milestone_history` | 014 | **YES — `milestones.ts` still writes it** |
| `tasks.recurrence_rule` (column) | 001/002 | **YES — `tasks.ts` data layer still references it** |

---

## Pre-Flight (once)

- [ ] **Branch**
```powershell
git checkout main; if ($?) { git pull }
git checkout -b cuts/phase-1d
```
(If 1C unmerged: `git checkout cuts/phase-1c; git pull; git checkout -b cuts/phase-1d`.)

- [ ] **Commit the plan doc**
```powershell
git add docs/superpowers/plans/2026-05-28-cuts-phase-1d-schema-sweep.md
git commit -m "docs: add Phase 1D schema-sweep plan"
```

- [ ] **Baseline**
```powershell
npm test   # record count (was 339 at end of Phase 1C)
npm run build
```

---

## Task 1: Remove Code Referencing Orphan Schema

**Why first:** the migration in Task 2 drops `milestone_history` and `tasks.recurrence_rule`. Both still have live code: `milestones.ts` writes milestone_history on every update, and `tasks.ts` INSERTs/UPDATEs the recurrence_rule column. If the column/table are dropped while this code runs, milestone updates and task creation throw. Remove the code first. This task leaves the orphan tables present-but-unreferenced — a valid state.

**Files:**
- Modify: `server/db/milestones.ts` (remove the `recordMilestoneChange` writer + import)
- Delete: `server/db/milestone_history.ts`
- Modify: `server/db/index.ts` (remove the milestone_history re-export)
- Modify: `server/db/tasks.ts` (remove `recurrence_rule` from `CreateTaskInput`, the INSERT, `UpdateTaskInput`, the UPDATE block)
- Modify: `server/routes/responses.ts` (remove dead `unauthorized()`)
- Delete: `tests/milestone_history.test.ts`
- Modify: `tests/db.test.ts` (remove `recurrence_rule` from the expected task-column assertion)

### Step 1.1: Confirm caller sets before editing
```powershell
Select-String -Path server\**\*.ts,src\**\*.ts -Pattern "recordMilestoneChange|listMilestoneHistorySince|recurrence_rule|unauthorized"
```
Expected (reconcile before editing):
- `recordMilestoneChange` — defined in `milestone_history.ts`; **called only in `server/db/milestones.ts:78`** + imported line 4. (`listMilestoneHistorySince` should have zero non-test callers — its reader, the tier3 detector, was deleted in 1B.)
- `recurrence_rule` — only in `server/db/tasks.ts` (lines 19, 30, 45, 97, 148-150) + `server/db/migrator.ts` (001/002 DDL — leave) + tests. Zero in routes/shared.
- `unauthorized` — defined in `server/routes/responses.ts:19`; confirm **zero callers** (`Select-String -Path server\**\*.ts -Pattern "unauthorized\("` should show only the definition). If a caller exists, STOP and report.

### Step 1.2: Remove the milestone_history writer from `milestones.ts`
Edit `server/db/milestones.ts`:

a. Remove the import (line 4):
```typescript
import { recordMilestoneChange, type WatchedMilestoneField } from "./milestone_history.js";
```

b. Remove the history-recording block in `updateMilestone` (lines 69-81):
```typescript
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
After removal, `updateMilestone` goes straight from the `if (sets.length === 0) return getMilestone(db, id);` guard to `sets.push("updated_at = ?");`. Verify `getMilestone` is still used elsewhere in the file (it is — line 67 and `completeMilestone`), so its definition/usage stays. Confirm no other reference to `existing` or `WatchedMilestoneField` remains in the file:
```powershell
Select-String -Path server\db\milestones.ts -Pattern "recordMilestoneChange|WatchedMilestoneField|\bexisting\b"
```
Expected: zero.

### Step 1.3: Delete `milestone_history.ts` + its re-export
```powershell
git rm server/db/milestone_history.ts
```
Edit `server/db/index.ts` — remove line 104:
```typescript
export * from "./milestone_history.js";
```

### Step 1.4: Remove `recurrence_rule` from `tasks.ts`
Edit `server/db/tasks.ts`:

a. `CreateTaskInput` (line 19) — delete:
```typescript
  recurrence_rule?: string | null;
```

b. The INSERT (lines 30-31). Current:
```typescript
    "INSERT INTO tasks (id, project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, status, priority, progress, due_date, start_date, estimate, recurrence_rule, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?) RETURNING *"
```
Becomes (drop `recurrence_rule,` from the column list and one `?` from VALUES):
```typescript
    "INSERT INTO tasks (id, project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, status, priority, progress, due_date, start_date, estimate, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) RETURNING *"
```
**Recount carefully:** the literal `0` occupies the `progress` slot. Original = 15 `?` + literal `0` = 16 columns. After removal = 14 `?` + literal `0` = 15 columns. Match the column list length to the placeholder count.

c. The bound value (line 45) — delete:
```typescript
    input.recurrence_rule ?? null,
```

d. `UpdateTaskInput` (line 97) — delete:
```typescript
  recurrence_rule?: string | null;
```

e. The UPDATE block (lines 148-151) — delete:
```typescript
  if (input.recurrence_rule !== undefined) {
    sets.push("recurrence_rule = ?");
    params.push(input.recurrence_rule);
  }
```

Verify: `Select-String -Path server\db\tasks.ts -Pattern "recurrence_rule"` → zero.

### Step 1.5: Remove dead `unauthorized()` from `responses.ts`
Edit `server/routes/responses.ts` — delete (lines 19-21):
```typescript
export function unauthorized(res: Response, message = "Unauthorized"): void {
  res.status(401).json({ error: message });
}

```
Keep `notFound`, `badRequest`, `conflict`, `serverError`, `forbidden` (verify each still has callers; if `forbidden` is also dead, grep — but only remove `unauthorized` unless you confirm others are dead too and report it).

### Step 1.6: Fix tests
- `git rm tests/milestone_history.test.ts` (entire file exercises the removed writer/reader).
- `tests/db.test.ts` (~line 60): remove `"recurrence_rule"` from the expected task-column-list assertion. Grep `tests/db.test.ts` for `recurrence_rule` → remove each occurrence (adjust any column-count assertion).
- Do NOT touch `tests/db-persistence.test.ts` yet — its migration-014 assertion still passes (the tables still exist after Task 1). Task 2 updates it.

### Step 1.7: Build, test, static analysis, commit
```powershell
npm run build
npm test
semgrep --config=auto --error server/db/milestones.ts server/db/index.ts server/db/tasks.ts server/routes/responses.ts
```
Build clean; tests pass (count drops by the milestone_history tests). Then code review (`superpowers:requesting-code-review`); address findings.
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status
git commit -m @'
chore: remove code referencing orphan schema (pre-migration cleanup)

Prepares for the Phase 1D schema drop by removing the last code that
touches soon-to-be-dropped schema:
- milestones.ts: drop the milestone_history writer (recordMilestoneChange
  + watched-field diffing) from updateMilestone; delete milestone_history.ts
  and its barrel re-export. The tier3 reader was already gone (1B); this
  removes the now-write-only path.
- tasks.ts: drop recurrence_rule from CreateTaskInput/UpdateTaskInput and
  the INSERT/UPDATE (dead since the 1A recurring-tasks removal).
- responses.ts: remove the unused unauthorized() helper.
- tests: delete milestone_history.test.ts; drop recurrence_rule from the
  db.test.ts column assertion.

Tables/column still exist (dropped in the next commit).

Part of Phase 1D schema sweep.
'@
```

### Constraints
- Do NOT add the migration yet (Task 2).
- Keep `getMilestone` (still used). Keep the other `responses.ts` helpers that have callers.
- Re-grep each edited file after editing.

---

## Task 2: Migration 015 — Drop Orphan Tables + Column

**Why second:** with the code no longer referencing `milestone_history` or `recurrence_rule` (Task 1), it's safe to drop them. This migration also drops the 7 fully-orphan tables.

**Files:**
- Modify: `server/db/migrator.ts` (append migration `015`)
- Modify: `tests/db-persistence.test.ts` (the migration-014 assertion now contradicts 015 — update it + add a 015 assertion)

### Step 2.1: Append migration 015
Edit `server/db/migrator.ts`. Find the end of the `MIGRATIONS` array — the `014_commits_and_milestone_history` entry followed by `];` (around line 521-522). Insert a new entry BEFORE the closing `];`, matching the existing entries' style. The body calls `db.exec(...)` with a SQL string (same as every other migration — match the exact `db.exec(` formatting used by migration 014 above it):

```typescript
  {
    name: "015_drop_orphan_tables_and_recurrence_column",
    run(db) {
      // Tables orphaned by Phases 1A-1C feature removals. All have only
      // outbound FKs to kept tables, so DROP succeeds under foreign_keys=ON.
      db.exec(
        [
          "DROP TABLE IF EXISTS task_reviews;",
          "DROP TABLE IF EXISTS webhooks;",
          "DROP TABLE IF EXISTS commits;",
          "DROP TABLE IF EXISTS milestone_history;",
          "DROP TABLE IF EXISTS git_linked_items;",
          "DROP TABLE IF EXISTS git_integrations;",
          "DROP TABLE IF EXISTS ingestion_events;",
          "DROP TABLE IF EXISTS ingestion_sources;",
          "DROP TABLE IF EXISTS users;",
        ].join("\n")
      );
      // Orphan column from the 1A recurring-tasks removal. SQLite has no
      // DROP COLUMN IF EXISTS, but this migration runs exactly once and the
      // column exists by migrations 001/002. No index/trigger references it.
      db.exec("ALTER TABLE tasks DROP COLUMN recurrence_rule;");
    },
  },
```
(The `.join("\n")` form is functionally identical to a backtick template and keeps each statement on its own auditable line. If you prefer, mirror migration 014's backtick-template style instead — either is fine, both pass to `db.exec`.)

### Step 2.2: Update the migration test
Edit `tests/db-persistence.test.ts`. The `describe("migration 014 — commits + milestone_history", ...)` block (lines ~94-129) asserts `commits` and `milestone_history` tables EXIST after migrations. After 015 they won't (a fresh DB runs 001→015). Update that block:
- Remove the assertions that `commits` / `milestone_history` exist post-migration (they're dropped by 015).
- If the block also verified migration 014's column shapes, that historical check is no longer meaningful as an end-state assertion — convert it to the Phase-1D end-state assertion (Step 2.3) or delete the block.

### Step 2.3: Add a 015 verification test
Add to `tests/db-persistence.test.ts` (or a new `tests/migration-015.test.ts`). Use the same imports/helpers the existing persistence tests use — `createTestDb()` from `tests/setup.ts` runs all migrations:
```typescript
describe("migration 015 — orphan schema dropped", () => {
  it("drops all orphan tables", () => {
    const db = createTestDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const orphan of [
      "task_reviews", "webhooks", "commits", "milestone_history",
      "git_linked_items", "git_integrations", "ingestion_events",
      "ingestion_sources", "users",
    ]) {
      expect(tables).not.toContain(orphan);
    }
  });

  it("drops the recurrence_rule column from tasks", () => {
    const db = createTestDb();
    const cols = (db.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("recurrence_rule");
  });

  it("keeps the core tables intact", () => {
    const db = createTestDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const kept of ["projects", "milestones", "tasks", "agents", "blockers"]) {
      expect(tables).toContain(kept);
    }
  });
});
```
(Match the file's actual `createTestDb` import + `describe/it/expect` import style — check the top of `tests/db-persistence.test.ts`.)

### Step 2.4: Build, test
```powershell
npm run build
npm test
```
Expected: build clean. The new 015 tests pass (fresh test DB runs all migrations including 015). All other tests pass.

### Step 2.5: Migration smoke on a fresh-from-scratch DB (idempotency + populated path)
A fresh test DB is covered by the unit test; also confirm `initDb` applies 015 cleanly end-to-end and is idempotent on a real file. Write a tiny scratch script and run it with tsx (the project's TS runner), then delete it:

Create `scratch-1d.mts`:
```typescript
import Database from "better-sqlite3";
import { initDb } from "./server/db/index.js";
import { existsSync, rmSync } from "fs";
const p = "./.smoke-1d.db";
if (existsSync(p)) rmSync(p);
const db = new Database(p);
initDb(db); // runs migrations 001..015 on a fresh file
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
const orphans = ["task_reviews","webhooks","commits","milestone_history","git_linked_items","git_integrations","ingestion_events","ingestion_sources","users"];
const present = orphans.filter((o) => tables.includes(o));
const cols = (db.pragma("table_info(tasks)") as { name: string }[]).map((c) => c.name);
console.log("orphan tables present:", present.length ? present : "NONE");
console.log("recurrence_rule in tasks:", cols.includes("recurrence_rule"));
console.log("core present:", ["projects","milestones","tasks","agents"].every((x) => tables.includes(x)));
initDb(db); // second run — 015 must NOT re-run (tracked) and must not error
console.log("second initDb OK (idempotent)");
db.close(); rmSync(p);
```
Run + clean up:
```powershell
npx tsx scratch-1d.mts
Remove-Item scratch-1d.mts -ErrorAction SilentlyContinue
```
Expected output: `orphan tables present: NONE`, `recurrence_rule in tasks: false`, `core present: true`, `second initDb OK (idempotent)`. If anything errors, STOP and report. (Do NOT commit `scratch-1d.mts`.)

### Step 2.6: Static analysis, code review, commit
```powershell
semgrep --config=auto --error server/db/migrator.ts
```
Code review (`superpowers:requesting-code-review`), marker, then:
```powershell
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A; git status   # verify scratch-1d.mts and .smoke-1d.db are NOT staged
git commit -m @'
chore: migration 015 — drop 9 orphan tables + recurrence_rule column

Drops the tables orphaned by Phases 1A-1C (task_reviews, webhooks,
commits, milestone_history, git_linked_items, git_integrations,
ingestion_events, ingestion_sources, users) and the recurrence_rule
column on tasks. All orphans had only outbound FKs, so the drops
succeed under foreign_keys=ON. The preceding commit removed the last
code referencing this schema.

Adds a migration-015 verification test and updates the stale
migration-014 table-existence assertion. Verified idempotent and
clean on a fresh DB.

Part of Phase 1D schema sweep.
'@
```

### Constraints
- Do NOT edit historical migrations 001-014 (immutable; the create-then-drop across the sequence is expected).
- Do NOT use `DROP COLUMN IF EXISTS` (invalid SQLite).
- The migration body must run via `db.exec(...)` inside the existing transaction-wrapped `run(db)` (runMigrations handles the transaction).
- Ensure `scratch-1d.mts` and `.smoke-1d.db` are deleted and never committed (add to `.gitignore` if you prefer, but deletion is enough).

---

## Final Verification + Wrap-Up + PR

### Step F.1: Branch summary
```powershell
git log --oneline main..HEAD   # plan doc + 2 commits
git diff --stat main..HEAD | tail -1
```

### Step F.2: CLAUDE.md
Grep CLAUDE.md for any mention of the dropped schema:
```powershell
Select-String -Path CLAUDE.md -Pattern "recurrence_rule|task_reviews|webhooks|milestone_history|ingestion|git_integrations|users table"
```
Remove/curtail any stale references (e.g. if Database Patterns or schema notes mention these). Likely minimal.

### Step F.3: Full verification
```powershell
npm run build
npm test
```

### Step F.4: End-to-end boot smoke
```powershell
npm run dev
```
- Server boots; migration 015 applies once with no error (check console).
- Dashboard + Kanban render; create a task (confirms the INSERT works without recurrence_rule); edit a milestone (confirms updateMilestone works without the history writer).
- WebSocket connected.
Stop the server. Then `npm run mcp:stdio` to confirm MCP still starts.

### Step F.5: Wrap-up commit (if CLAUDE.md changed) + push + PR
```powershell
git add CLAUDE.md   # if changed
git commit -m "chore: Phase 1D wrap-up — CLAUDE.md schema notes"   # if needed
git push -u origin cuts/phase-1d
gh pr create --base main --title "chore: Phase 1D — schema sweep (drop 9 orphan tables + recurrence_rule)" --body @'
## Summary

Final cleanup of the cut effort (follows #105/#106/#107). Drops the schema orphaned by Phases 1A-1C and the last code that referenced it.

- **Migration 015** drops 9 orphan tables (task_reviews, webhooks, commits, milestone_history, git_linked_items, git_integrations, ingestion_events, ingestion_sources, users) and the `tasks.recurrence_rule` column.
- **Pre-migration code cleanup:** removed the still-live `milestone_history` writer from `updateMilestone` (the tier3 reader was already gone), the dead `recurrence_rule` data-layer references in `tasks.ts`, the unused `unauthorized()` helper, and the obsolete milestone_history test.

All orphan tables had only outbound FKs to kept tables, so the drops succeed under `foreign_keys=ON`. Verified idempotent and clean on a fresh DB.

## Test plan
- [ ] npm run build clean
- [ ] npm test passes (incl. new migration-015 verification test)
- [ ] initDb applies 015 once, cleanly, and is idempotent on a second run (smoke)
- [ ] Create a task + edit a milestone in the running app (exercises the edited data layer)
- [ ] MCP stdio + WebSocket still work

> security/snyk fails on a quota limit — skip per prior guidance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Notes
- This is the lowest-user-value phase (orphan tables are inert), but it leaves the schema honest for future readers and closes out the cut effort. After this, the only remaining work is **Phase 2 (sharpening)** — the additive Dashboard/Kanban/MCP improvements from the original assessment.
- If you want the absolute-safest scope, the `recurrence_rule` column drop is the only part touching a hot path (`tasks.ts` createTask/updateTask). It's still low-risk (the refs are dead), but it could be split into its own follow-up if desired. The 9 table drops carry zero code risk.
- **Migration immutability caveat:** because 015 drops tables/column that earlier migrations created, anyone inspecting the migration list will see create-then-drop. That's normal and intentional — we never edit shipped migrations.
