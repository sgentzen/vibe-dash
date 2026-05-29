# MCP Heartbeat + Project Context Implementation Plan (Phase 2C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools — `heartbeat(status)` (agent reports a freeform "what I'm doing now", stored on the agent) and `get_project_context(project_id)` (one-call read-only orientation) — and surface the status in the Live Roster.

**Architecture:** Server/MCP-centric. Migration 016 adds `current_status`/`current_status_at` to `agents`; a `setAgentStatus` helper + `heartbeat` tool write them (the existing MCP `call()` wrapper keeps `last_seen_at` fresh). A `getProjectContext` read aggregator composes existing DB fns + two small project-scoped queries, exposed via `get_project_context`. The status surfaces on `/api/agents` (automatically — `parseAgent` spreads the row) and renders in `LiveRosterCard` with fallback to the task title.

**Tech Stack:** Node 20, TypeScript strict, better-sqlite3, @modelcontextprotocol/sdk, Zod, React 19, Vitest. ESM with `.js` import extensions.

**Spec:** `docs/superpowers/specs/2026-05-28-mcp-heartbeat-project-context-design.md`
**Branch:** `feat/phase-2c-mcp-tools` (off `main`; independent of the open 2B PR).

**Key codebase facts (verified):**
- MCP tools register in `server/mcp/server.ts` via `server.tool(name, desc, zodShape, call(name))`; dispatched through the `HANDLERS` map in `server/mcp/tools.ts`; `handleTool` resolves `agentName` from `args.agent_name ?? defaultAgentName`.
- `parseAgent(row)` (server/db/helpers.ts) does `...(row as ...)` — it **spreads the whole row**, so new columns flow into the `Agent` object automatically once they exist + the type declares them. `listAgents`/`getAgentByName` use `SELECT *`. `/api/agents` (server/routes/agents.ts) spreads `...a`, so the fields surface there with no route change.
- Agent name lookups use `normalizeAgentName(name)` + `WHERE name_normalized = ?`. `now()` (server/db/helpers.ts) gives an ISO timestamp.
- `getRecentActivity(db, limit)` is global (no project filter) → `getProjectContext` uses a small project-scoped activity query. `getActiveBlockers(db)` is global → use a project-scoped blocker query. `listMilestones(db, projectId)`, `getMilestoneProgress(db, milestoneId)`, `listTasks(db, { project_id, status })` exist and are project-aware.
- Highest migration is `015`. Migrations are `{ name, run(db) }` entries in the `MIGRATIONS` array in `server/db/migrator.ts`.

---

## File Structure
- Modify: `server/db/migrator.ts` — migration 016 (2 columns).
- Modify: `shared/types.ts` — `Agent` gains `current_status?`, `current_status_at?`.
- Modify: `server/db/agents.ts` — `setAgentStatus(db, agentName, status)`.
- Create: `server/db/projectContext.ts` — `getProjectContext(db, projectId)` + `ProjectContext` type.
- Modify: `server/db/index.ts` — barrel exports for the two new helpers.
- Modify: `server/mcp/tools.ts` — HANDLERS entries `heartbeat`, `get_project_context`.
- Modify: `server/mcp/server.ts` — register both tools.
- Modify: `src/components/dashboard/LiveRosterCard.tsx` — show `current_status`, fall back to task title.
- Tests: `tests/mcp-2c.test.ts` (migration + heartbeat + project context), `tests/components/LiveRosterCard.test.tsx` (status display).

---

## Pre-Flight
- [ ] **Confirm branch + baseline**
```powershell
git branch --show-current   # feat/phase-2c-mcp-tools
npm test                    # record count
npm run build               # clean
```

---

## Task 1: Migration 016 — agent status columns + Agent type

**Files:**
- Modify: `server/db/migrator.ts`
- Modify: `shared/types.ts`
- Test: `tests/mcp-2c.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/mcp-2c.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

describe("migration 016 — agent status columns", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("adds current_status and current_status_at to agents", () => {
    const cols = (db.pragma("table_info(agents)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("current_status");
    expect(cols).toContain("current_status_at");
  });
});
```
(Match the `createTestDb` import style used by neighboring tests, e.g. `tests/live-roster-data.test.ts`.)

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/mcp-2c.test.ts`
Expected: FAIL — columns don't exist.

- [ ] **Step 3: Add migration 016**

In `server/db/migrator.ts`, insert a new entry before the closing `];` of the `MIGRATIONS` array (after the `015_...` entry), matching the existing `{ name, run(db) }` shape. Run the two `ALTER TABLE` statements via `db.prepare(...).run()` (SQLite supports DDL through a prepared statement; one column per statement):
```typescript
  {
    name: "016_agent_current_status",
    run(db) {
      db.prepare("ALTER TABLE agents ADD COLUMN current_status TEXT").run();
      db.prepare("ALTER TABLE agents ADD COLUMN current_status_at TEXT").run();
    },
  },
```
Both columns are nullable; existing rows get NULL. (Other migrations use the multi-statement runner with a template string; using two `prepare(...).run()` calls here is equivalent for two single-column ALTERs and keeps each statement explicit.)

- [ ] **Step 4: Add the fields to the `Agent` type**

In `shared/types.ts`, in the `Agent` interface, after the existing enrichment fields (`completed_today?` etc.), add:
```typescript
  current_status?: string | null;
  current_status_at?: string | null;
```

- [ ] **Step 5: Run test + build**

Run: `npx vitest run tests/mcp-2c.test.ts` (PASS), then `npm run build` (clean).

- [ ] **Step 6: Commit**
```powershell
New-Item -ItemType Directory -Force -Path .claude | Out-Null
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add server/db/migrator.ts shared/types.ts tests/mcp-2c.test.ts
git commit -m "feat(2c): migration 016 — agent current_status columns + type"
```

### Constraints
- Do NOT edit historical migrations 001-015. Additive only.

---

## Task 2: `setAgentStatus` helper + `heartbeat` MCP tool

**Files:**
- Modify: `server/db/agents.ts`, `server/db/index.ts`
- Modify: `server/mcp/tools.ts`, `server/mcp/server.ts`
- Test: `tests/mcp-2c.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-2c.test.ts`:
```typescript
import { registerAgent, setAgentStatus, getAgentByName } from "../server/db/index.js";

describe("setAgentStatus", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("sets and overwrites the agent's current status", () => {
    registerAgent(db, { name: "coder-1", model: null, capabilities: [] });
    setAgentStatus(db, "coder-1", "running tests");
    let a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("running tests");
    expect(a.current_status_at).toBeTruthy();
    setAgentStatus(db, "coder-1", "writing migration");
    a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("writing migration");
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/mcp-2c.test.ts -t "setAgentStatus"`
Expected: FAIL — `setAgentStatus` not exported.

- [ ] **Step 3: Add `setAgentStatus` to `server/db/agents.ts`**

`now` and `normalizeAgentName` are already imported in this file. Add:
```typescript
export function setAgentStatus(db: Database.Database, agentName: string, status: string): void {
  const normalized = normalizeAgentName(agentName);
  db.prepare(
    "UPDATE agents SET current_status = ?, current_status_at = ? WHERE name_normalized = ?"
  ).run(status, now(), normalized);
}
```

- [ ] **Step 4: Barrel-export it**

In `server/db/index.ts`, add `setAgentStatus` to the `export { ... } from "./agents.js";` block.

- [ ] **Step 5: Run — confirm the helper test passes**

Run: `npx vitest run tests/mcp-2c.test.ts -t "setAgentStatus"`
Expected: PASS. (`getAgentByName` returns a `parseAgent` row spread, so `current_status`/`current_status_at` are present.)

- [ ] **Step 6: Add the `heartbeat` handler in `server/mcp/tools.ts`**

Import `setAgentStatus` (add to the existing `import { ... } from "../db/index.js";` block at the top). Add an entry to the `HANDLERS` map:
```typescript
  heartbeat: (db, args, agentName) => {
    if (agentName) setAgentStatus(db, agentName, args.status as string);
    return ok({ success: true });
  },
```

- [ ] **Step 7: Register the tool in `server/mcp/server.ts`**

`z` is already imported. Add a registration (alongside the others, before `return { server, cleanup };`):
```typescript
  server.tool(
    "heartbeat",
    "Report what you're working on right now (a short freeform status)",
    { status: z.string().min(1).max(280) },
    call("heartbeat")
  );
```
(The `call()` wrapper already touches `last_seen_at`, so a heartbeat marks the agent active.)

- [ ] **Step 8: Build + test + static analysis + commit**
```powershell
npm run build
npm test
semgrep --config=auto --error server/db/agents.ts server/db/index.ts server/mcp/tools.ts server/mcp/server.ts
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add server/db/agents.ts server/db/index.ts server/mcp/tools.ts server/mcp/server.ts tests/mcp-2c.test.ts
git commit -m "feat(2c): add heartbeat MCP tool + setAgentStatus"
```

### Constraints
- `heartbeat` only writes status; no broadcast (the Dashboard's 3s poll surfaces it — do NOT invent a new WS event).
- Status is latest-wins, no auto-clear.

---

## Task 3: `getProjectContext` + `get_project_context` MCP tool

**Files:**
- Create: `server/db/projectContext.ts`
- Modify: `server/db/index.ts`, `server/mcp/tools.ts`, `server/mcp/server.ts`
- Test: `tests/mcp-2c.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/mcp-2c.test.ts`:
```typescript
import { createProject, createMilestone, createTask, updateTask, createBlocker, getProjectContext } from "../server/db/index.js";

describe("getProjectContext", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("returns focused orientation for a project", () => {
    const p = createProject(db, { name: "P", description: null });
    const other = createProject(db, { name: "Other", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M1" });
    const t1 = createTask(db, { project_id: p.id, title: "active", priority: "medium", milestone_id: m.id });
    updateTask(db, t1.id, { status: "in_progress" });
    const t2 = createTask(db, { project_id: p.id, title: "blocked-task", priority: "medium" });
    createBlocker(db, { task_id: t2.id, reason: "stuck" });
    // a task in another project must NOT appear
    const o1 = createTask(db, { project_id: other.id, title: "other-active", priority: "medium" });
    updateTask(db, o1.id, { status: "in_progress" });

    const ctx = getProjectContext(db, p.id);
    expect(ctx.project?.id).toBe(p.id);
    expect(ctx.open_milestones.map((mm) => mm.id)).toContain(m.id);
    expect(ctx.open_milestones[0]?.progress).toBeDefined();
    expect(ctx.in_progress_tasks.map((t) => t.id)).toEqual([t1.id]); // only this project's in-progress
    expect(ctx.active_blockers.some((b) => b.task_id === t2.id)).toBe(true);
    expect(Array.isArray(ctx.recent_activity)).toBe(true);
  });

  it("returns null project for an unknown id", () => {
    const ctx = getProjectContext(db, "nope");
    expect(ctx.project).toBeNull();
    expect(ctx.in_progress_tasks).toEqual([]);
  });
});
```
(Adapt `createMilestone`/`createTask`/`createBlocker` input shapes to the real `Create*Input` types if they differ.)

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/mcp-2c.test.ts -t "getProjectContext"`
Expected: FAIL — not exported.

- [ ] **Step 3: Create `server/db/projectContext.ts`**

```typescript
import type Database from "better-sqlite3";
import type { Project, Milestone, Task, Blocker, ActivityEntry, MilestoneProgress } from "../types.js";
import { listMilestones, getMilestoneProgress } from "./milestones.js";
import { listTasks } from "./tasks.js";

export interface ProjectContext {
  project: Project | null;
  open_milestones: (Milestone & { progress: MilestoneProgress })[];
  in_progress_tasks: Task[];
  active_blockers: Blocker[];
  recent_activity: ActivityEntry[];
}

const RECENT_ACTIVITY_LIMIT = 10;

export function getProjectContext(db: Database.Database, projectId: string): ProjectContext {
  const project =
    (db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as Project | undefined) ?? null;

  const open_milestones = listMilestones(db, projectId)
    .filter((m) => m.status === "open")
    .map((m) => ({ ...m, progress: getMilestoneProgress(db, m.id) }));

  const in_progress_tasks = listTasks(db, { project_id: projectId, status: "in_progress" });

  const active_blockers = db
    .prepare(
      "SELECT b.* FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE t.project_id = ? AND b.resolved_at IS NULL ORDER BY b.reported_at DESC"
    )
    .all(projectId) as Blocker[];

  const recent_activity = db
    .prepare(
      "SELECT a.id, a.task_id, a.agent_id, a.message, a.timestamp, a.source, ag.name AS agent_name, t.title AS task_title " +
        "FROM activity_log a LEFT JOIN agents ag ON a.agent_id = ag.id JOIN tasks t ON a.task_id = t.id " +
        "WHERE t.project_id = ? ORDER BY a.timestamp DESC LIMIT ?"
    )
    .all(projectId, RECENT_ACTIVITY_LIMIT) as ActivityEntry[];

  return { project, open_milestones, in_progress_tasks, active_blockers, recent_activity };
}
```
(SQL as concatenated strings for auditability; the `recent_activity` columns mirror `getRecentActivity` in `server/db/activity.ts`. Confirm `listTasks`'s filter accepts `{ project_id, status }` — it does per `ListTasksFilter`.)

- [ ] **Step 4: Barrel-export**

In `server/db/index.ts`: add `export { getProjectContext } from "./projectContext.js";` and `export type { ProjectContext } from "./projectContext.js";`.

- [ ] **Step 5: Run — confirm the helper tests pass**

Run: `npx vitest run tests/mcp-2c.test.ts -t "getProjectContext"`
Expected: PASS (both cases).

- [ ] **Step 6: Add the `get_project_context` handler in `server/mcp/tools.ts`**

Import `getProjectContext` (add to the `../db/index.js` import block). Add to `HANDLERS`:
```typescript
  get_project_context: (db, args) => ok(getProjectContext(db, args.project_id as string)),
```

- [ ] **Step 7: Register the tool in `server/mcp/server.ts`**
```typescript
  server.tool(
    "get_project_context",
    "Get a project's current state in one call: open milestones (with progress), in-progress tasks, active blockers, and recent activity",
    { project_id: z.string() },
    call("get_project_context")
  );
```

- [ ] **Step 8: Build + test + static analysis + commit**
```powershell
npm run build
npm test
semgrep --config=auto --error server/db/projectContext.ts server/db/index.ts server/mcp/tools.ts server/mcp/server.ts
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add server/db/projectContext.ts server/db/index.ts server/mcp/tools.ts server/mcp/server.ts tests/mcp-2c.test.ts
git commit -m "feat(2c): add get_project_context MCP tool (read-only orientation)"
```

### Constraints
- `getProjectContext` is READ-ONLY — no INSERT/UPDATE, no broadcast.
- Scope blockers + activity to the project (inline joins on `t.project_id`); only `open` milestones; only `in_progress` tasks.

---

## Task 4: Surface `current_status` in the Live Roster

**Files:**
- Modify: `src/components/dashboard/LiveRosterCard.tsx`
- Test: `tests/components/LiveRosterCard.test.tsx` (extend)

Context: `/api/agents` already carries `current_status`/`current_status_at` automatically (parseAgent spreads the row; the route spreads `...a`; the `Agent` type now declares them). `LiveRosterCard`'s "doing" line currently renders `a.current_task_title ?? "— idle, no active task —"`. Prefer the heartbeat status.

- [ ] **Step 1: Write the failing test**

Add to `tests/components/LiveRosterCard.test.tsx` (reuse the file's existing `agent()` fixture + render helper; adapt names to the file's actual conventions):
```tsx
it("shows current_status when present, above the task-title fallback", () => {
  const a = agent({ current_status: "running test suite", current_task_title: "Implement migration 015" });
  render(<LiveRosterCard agents={[a]} tasks={[]} />);
  expect(screen.getByText("running test suite")).toBeInTheDocument();
  expect(screen.queryByText("Implement migration 015")).not.toBeInTheDocument();
});

it("falls back to the task title when there is no current_status", () => {
  const a = agent({ current_status: null, current_task_title: "Implement migration 015" });
  render(<LiveRosterCard agents={[a]} tasks={[]} />);
  expect(screen.getByText("Implement migration 015")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/LiveRosterCard.test.tsx -t "current_status"`
Expected: FAIL (first test — card shows the task title, not the status).

- [ ] **Step 3: Update `LiveRosterCard.tsx`**

Find the "doing" line in the live-agent card. It currently reads (approximately):
```tsx
            <div style={{ marginTop: "6px", color: a.current_task_title ? "var(--text-primary)" : "var(--text-muted)", fontSize: "13px" }}>
              {a.current_task_title ?? "— idle, no active task —"}
            </div>
```
Change the displayed value to prefer `current_status`, and update the color condition to match:
```tsx
            <div style={{ marginTop: "6px", color: (a.current_status ?? a.current_task_title) ? "var(--text-primary)" : "var(--text-muted)", fontSize: "13px" }}>
              {a.current_status ?? a.current_task_title ?? "— idle, no active task —"}
            </div>
```
(Status age is intentionally not shown — the freshness dot + `last_seen_at` already convey recency; keep the line clean.)

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/LiveRosterCard.test.tsx`
Expected: PASS (new + existing roster tests).

- [ ] **Step 5: Build + static analysis + commit**
```powershell
npm run build
npm test
semgrep --config=auto --error src/components/dashboard/LiveRosterCard.tsx
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add src/components/dashboard/LiveRosterCard.tsx tests/components/LiveRosterCard.test.tsx
git commit -m "feat(2c): show heartbeat status in Live Roster (fallback to task title)"
```

### Constraints
- Only change the "doing" line value + its color condition. Don't touch the freshness dot, completed-today, sorting, or offline footer.
- `current_status` is optional on `Agent`; `?? a.current_task_title ?? "..."` handles null/undefined.

---

## Final Verification + PR

- [ ] **Branch summary + full build/test**
```powershell
git log --oneline main..HEAD
npm run build
npm test
```

- [ ] **MCP smoke (proof the tools register + the server boots).** Boot the server on a scratch DB and list tools over `/mcp`:
```powershell
$env:PORT="3092"; $env:DB_PATH="./.smoke-2c.db"
$p = Start-Process npx -ArgumentList "tsx","server/index.ts" -PassThru -NoNewWindow -RedirectStandardError ".2c.log" -RedirectStandardOutput ".2c.out"
Start-Sleep -Seconds 7
Get-Content .2c.out, .2c.log
curl.exe -s -X POST http://localhost:3092/mcp -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}'
Stop-Process -Id $p.Id -Force
Remove-Item .smoke-2c.db,.2c.log,.2c.out -ErrorAction SilentlyContinue
```
Confirm the `tools/list` response includes `heartbeat` and `get_project_context`. (Note: `tools/list` without an initialize handshake may return a session error depending on the SDK; if so, confirm registration via the passing integration tests + a clean boot instead — the handlers are exercised directly by `tests/mcp-2c.test.ts`.) Also run `npm run mcp:stdio` briefly — it should start cleanly.

- [ ] **Code review** — invoke `superpowers:requesting-code-review`; address findings; touch `.claude/.last-code-review`.

- [ ] **CLAUDE.md** — grep for an MCP-tools list; if one enumerates tools, add `heartbeat` + `get_project_context`. (Likely only a high-level `mcp/tools.ts` reference — confirm; update only if stale.)

- [ ] **Push + PR (base = main)**
```powershell
git push -u origin feat/phase-2c-mcp-tools
gh pr create --base main --title "feat: Phase 2C — MCP heartbeat + get_project_context" --body @'
## Summary
Adds two MCP tools and surfaces the first in the Live Roster:
- **heartbeat(status)** — an agent reports a freeform "what I'm doing now". Stored on the agent (migration 016: current_status + current_status_at; latest-wins). The Live Roster shows it, falling back to the in-progress task title.
- **get_project_context(project_id)** — read-only one-call orientation: open milestones (with progress), in-progress tasks, active blockers, recent activity. Composes existing DB fns + project-scoped queries.

No auth (MCP runs unauthenticated post-1C); get_project_context is read-only; additive schema (migration 016). Spec: docs/superpowers/specs/2026-05-28-mcp-heartbeat-project-context-design.md

## Test plan
- [ ] npm run build clean; npm test green (migration 016, setAgentStatus, getProjectContext, LiveRosterCard status display)
- [ ] tools/list over /mcp includes heartbeat + get_project_context; server + mcp:stdio boot clean
- [ ] Roster shows heartbeat status, falls back to task title when absent

> security/snyk fails on a quota limit — skip per prior guidance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Notes
- **`parseAgent` spread** means the status columns surface on `/api/agents` with zero route changes — only the migration + type are needed for the data path.
- **No new WS event** — the Dashboard's existing 3s poll picks up status changes.
- **Clean seam honored:** the roster's "doing" line now prefers `current_status`, exactly the fallback the 2A spec anticipated.
- This is the last Phase 2 piece. After it: the optional `server/routes.ts` dead-monolith cleanup (flagged in the 2A final review) remains as standalone housekeeping.
