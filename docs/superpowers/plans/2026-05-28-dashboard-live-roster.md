# Dashboard Live Roster Implementation Plan (Phase 2A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hero row at the top of the Dashboard overview — a live agent roster (left) beside a "Today" momentum tile (right) — answering "what is each agent doing right now" from existing data.

**Architecture:** Mostly frontend. Two new presentational components (`LiveRosterCard`, `TodayCard`) composed into `DashboardView`, fed by store state. Two small read-only backend additions supply the only missing figures: per-agent `completed_today` on `/api/agents`, and `spend_today` + `tasks_completed_today` on `/api/stats`. No schema change, no new MCP tool, no new background process. Real-time comes free from the existing WebSocket + 3s polling.

**Tech Stack:** TypeScript 6 (strict, ESM `.js` imports), better-sqlite3, Express 5, React 19, Vitest. Server day-boundary convention is **UTC** (matches existing `getAgentCompletedToday`).

**Spec:** `docs/superpowers/specs/2026-05-28-dashboard-live-roster-design.md`

---

## File Structure

**Backend (modify):**
- `server/db/costs.ts` — add `getSpendToday(db)`.
- `server/db/tasks.ts` — add `getTasksCompletedToday(db)`.
- `server/db/index.ts` — re-export the two new helpers (barrel).
- `server/routes/agents.ts` — add `completed_today` to each item in the `GET /api/agents` map.
- `server/routes/system.ts` — add `spend_today` + `tasks_completed_today` to the `GET /api/stats` response.
- `shared/types.ts` — add the enrichment fields (`health_status?`, `active?`, `completed_today?`) to `Agent`.

**Frontend (create):**
- `src/utils/time.ts` — extracted `relativeTime` helper (DRY; currently private in `AgentFeed.tsx`).
- `src/components/dashboard/TodayCard.tsx` — the momentum tile.
- `src/components/dashboard/LiveRosterCard.tsx` — the agent roster.

**Frontend (modify):**
- `src/components/AgentFeed.tsx` — import `relativeTime` from the new util instead of its private copy.
- `src/hooks/useApi.ts` — extend the `getStats()` return type with the two new fields.
- `src/store.tsx` (and/or `src/state/types.ts`) — extend the stats slice type with the two new fields.
- `src/components/DashboardView.tsx` — insert the hero row above the KPI grid.

**Tests (create):**
- `tests/live-roster-data.test.ts` — backend: the two helpers + the enriched route responses.
- `tests/components/TodayCard.test.tsx`, `tests/components/LiveRosterCard.test.tsx`.

---

## Pre-Flight

- [ ] **Confirm branch + baseline** (you should be on `feat/phase-2a-live-roster`, branched from main with 1A–1D merged)
```powershell
git branch --show-current   # feat/phase-2a-live-roster
npm test                    # record the passing count
npm run build               # vite + 2x tsc, must be clean
```

---

## Task 1: Backend — per-agent `completed_today` on `/api/agents`

**Files:**
- Modify: `shared/types.ts` (add enrichment fields to `Agent`)
- Modify: `server/routes/agents.ts:21-37` (the `GET /api/agents` handler)
- Test: `tests/live-roster-data.test.ts`

Context: `GET /api/agents` already enriches each agent with `health_status`, `active`, `current_task_title`, `current_project_id`, `current_project_name` (see `server/routes/agents.ts`). It does NOT include `completed_today` (only `GET /api/agents/:id` does). `getAgentCompletedToday(db, id)` already exists and is already imported in `agents.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/live-roster-data.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, createProject, createTask, updateTask, completeTask, listAgents, getAgentCompletedToday } from "../server/db/index.js";

describe("live roster data — per-agent completed_today", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("counts tasks an agent completed today", () => {
    const agent = registerAgent(db, { name: "coder-1", model: null, capabilities: [] });
    const project = createProject(db, { name: "P", description: null });
    const task = createTask(db, { project_id: project.id, title: "t", priority: "medium", assigned_agent_id: agent.id });
    updateTask(db, task.id, { status: "in_progress" });
    completeTask(db, task.id);
    expect(getAgentCompletedToday(db, agent.id)).toBe(1);
    // and the enriched list shape carries it (computed in the route; here assert the helper the route will use)
    const agents = listAgents(db);
    expect(agents.find((a) => a.id === agent.id)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it — confirm it passes for the helper** (the helper already exists)

Run: `npx vitest run tests/live-roster-data.test.ts -t "completed_today"`
Expected: PASS (this step verifies the data helper; the route wiring is asserted via the route test added later). If `createTestDb`/imports resolve incorrectly, fix the import paths to match `tests/setup.ts` conventions before proceeding.

- [ ] **Step 3: Add enrichment fields to the `Agent` type**

In `shared/types.ts`, the `Agent` interface already has optional `current_task_title?`, `current_project_id?`, `current_project_name?`. Add three more optional enrichment fields right after them:
```typescript
  health_status?: AgentHealthStatus;
  active?: boolean;
  completed_today?: number;
```
(`AgentHealthStatus` is already defined in this file as `"active" | "idle" | "offline"`.)

- [ ] **Step 4: Add `completed_today` to the `/api/agents` map**

In `server/routes/agents.ts`, the `GET /api/agents` handler maps agents to an enriched object. Add `completed_today` to that object:
```typescript
      return {
        ...a,
        health_status,
        active: health_status === "active",
        completed_today: getAgentCompletedToday(db, a.id),
        current_task_title: getAgentCurrentTask(db, a.id),
        current_project_id: project?.project_id ?? null,
        current_project_name: project?.project_name ?? null,
      };
```
(`getAgentCompletedToday` is already imported in this file — no new import needed.)

- [ ] **Step 5: Build to confirm types**

Run: `npm run build`
Expected: clean (the new optional fields don't break existing consumers; existing casts like `(agent as Agent & { health_status?: string })` still compile).

- [ ] **Step 6: Commit**
```powershell
git add shared/types.ts server/routes/agents.ts tests/live-roster-data.test.ts
git commit -m "feat(2a): expose completed_today on /api/agents + type agent enrichment fields"
```

---

## Task 2: Backend — `spend_today` + `tasks_completed_today` on `/api/stats`

**Files:**
- Modify: `server/db/costs.ts` (add `getSpendToday`)
- Modify: `server/db/tasks.ts` (add `getTasksCompletedToday`)
- Modify: `server/db/index.ts` (barrel re-exports)
- Modify: `server/routes/system.ts:24-40` (the `GET /api/stats` handler)
- Modify: `src/hooks/useApi.ts:51-60` (`getStats` return type)
- Test: `tests/live-roster-data.test.ts` (extend)

Context: `GET /api/stats` (in `server/routes/system.ts`) returns `{ projects, tasks, activeAgents, alerts }`. `getStats()` in `useApi.ts` types that shape. We add two cumulative "today" figures. Use UTC start-of-day to match `getAgentCompletedToday` (`new Date(); setUTCHours(0,0,0,0)`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/live-roster-data.test.ts`:
```typescript
import { getSpendToday, getTasksCompletedToday, logCost } from "../server/db/index.js";

describe("live roster data — today summary figures", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("getSpendToday sums only today's cost entries", () => {
    const p = createProject(db, { name: "P", description: null });
    logCost(db, { agent_id: null, task_id: null, milestone_id: null, project_id: p.id, model: "m", provider: "x", input_tokens: 10, output_tokens: 5, cost_usd: 1.25 });
    logCost(db, { agent_id: null, task_id: null, milestone_id: null, project_id: p.id, model: "m", provider: "x", input_tokens: 10, output_tokens: 5, cost_usd: 0.75 });
    expect(getSpendToday(db)).toBeCloseTo(2.0, 5);
  });

  it("getTasksCompletedToday counts only today's done tasks", () => {
    const p = createProject(db, { name: "P", description: null });
    const t1 = createTask(db, { project_id: p.id, title: "a", priority: "medium" });
    const t2 = createTask(db, { project_id: p.id, title: "b", priority: "medium" });
    completeTask(db, t1.id);
    expect(getTasksCompletedToday(db)).toBe(1);
    completeTask(db, t2.id);
    expect(getTasksCompletedToday(db)).toBe(2);
  });
});
```

- [ ] **Step 2: Run — confirm they fail**

Run: `npx vitest run tests/live-roster-data.test.ts -t "today summary"`
Expected: FAIL — `getSpendToday`/`getTasksCompletedToday` are not exported.

- [ ] **Step 3: Add `getSpendToday` to `server/db/costs.ts`**

Open `server/db/costs.ts` and find the existing global cost summary (e.g. `getGlobalCostSummary`) to copy the exact cost table + column names. The cost table holds `cost_usd` and `created_at`. Add:
```typescript
export function getSpendToday(db: Database.Database): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_entries WHERE created_at >= ?"
    )
    .get(todayStart.toISOString()) as { total: number };
  return row.total;
}
```
**Before running:** confirm the table name is `cost_entries` by checking the FROM clause in `getGlobalCostSummary` in the same file; if it differs, use the actual name. Match the file's existing `import type Database` style.

- [ ] **Step 4: Add `getTasksCompletedToday` to `server/db/tasks.ts`**

Add (mirrors `getAgentCompletedToday`'s UTC boundary + the `status='done' AND updated_at >= ?` pattern used in `getAgentStats`):
```typescript
export function getTasksCompletedToday(db: Database.Database): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM tasks WHERE status = 'done' AND updated_at >= ?"
    )
    .get(todayStart.toISOString()) as { n: number };
  return row.n;
}
```

- [ ] **Step 5: Re-export both from the barrel**

In `server/db/index.ts`: add `getSpendToday` to the `export { ... } from "./costs.js";` block and `getTasksCompletedToday` to the `export { ... } from "./tasks.js";` block.

- [ ] **Step 6: Run — confirm the helper tests pass**

Run: `npx vitest run tests/live-roster-data.test.ts -t "today summary"`
Expected: PASS.

- [ ] **Step 7: Wire into `/api/stats`**

In `server/routes/system.ts`, import the two helpers (from `../db/index.js`) and extend the response:
```typescript
    res.json({
      projects,
      tasks,
      activeAgents,
      alerts,
      spend_today: getSpendToday(db),
      tasks_completed_today: getTasksCompletedToday(db),
    });
```

- [ ] **Step 8: Extend the `getStats()` return type**

In `src/hooks/useApi.ts` (the `getStats` function ~line 51), add the two fields to the return type:
```typescript
async function getStats(): Promise<{
  projects: number;
  tasks: number;
  activeAgents: number;
  alerts: number;
  spend_today: number;
  tasks_completed_today: number;
}> {
```

- [ ] **Step 9: Extend the store stats slice type**

Find where the `SET_STATS` payload type / stats slice is declared (`src/state/types.ts` or `src/store.tsx` — grep for `SET_STATS` and `activeAgents`). Add `spend_today: number;` and `tasks_completed_today: number;` to that type so the store carries them. If the slice uses a shared type with `getStats`, update the single source.

- [ ] **Step 10: Build + full test**

Run: `npm run build` then `npm test`
Expected: clean build; all tests pass including the new today-summary tests.

- [ ] **Step 11: Commit**
```powershell
git add server/db/costs.ts server/db/tasks.ts server/db/index.ts server/routes/system.ts src/hooks/useApi.ts src/state/types.ts src/store.tsx tests/live-roster-data.test.ts
git commit -m "feat(2a): add spend_today + tasks_completed_today to /api/stats"
```
(Stage only the files you actually changed in steps 9 — `src/state/types.ts` vs `src/store.tsx` depends on where the slice type lives.)

---

## Task 3: Frontend — extract `relativeTime` to a shared util (DRY)

**Files:**
- Create: `src/utils/time.ts`
- Modify: `src/components/AgentFeed.tsx` (use the shared helper)
- Test: `tests/components/time.test.ts`

Context: `AgentFeed.tsx` has a private `relativeTime(ts)` (lines ~12-21). `LiveRosterCard` needs the same. Extract it so both share one implementation.

- [ ] **Step 1: Write the failing test**

Create `tests/components/time.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { relativeTime } from "../../src/utils/time";

describe("relativeTime", () => {
  it("formats seconds, minutes, hours, days", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe("5s ago");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/time.test.ts`
Expected: FAIL — `src/utils/time` does not exist.

- [ ] **Step 3: Create `src/utils/time.ts`**

```typescript
export function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.max(0, Math.floor(diff / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
```

- [ ] **Step 4: Update `AgentFeed.tsx` to import it**

In `src/components/AgentFeed.tsx`, delete the private `relativeTime` function (lines ~12-21) and add an import at the top:
```typescript
import { relativeTime } from "../utils/time";
```
Verify no other now-unused references remain.

- [ ] **Step 5: Run test + build**

Run: `npx vitest run tests/components/time.test.ts` (PASS), then `npm run build` (clean).

- [ ] **Step 6: Commit**
```powershell
git add src/utils/time.ts src/components/AgentFeed.tsx tests/components/time.test.ts
git commit -m "refactor(2a): extract relativeTime to shared util"
```

---

## Task 4: Frontend — `TodayCard` component

**Files:**
- Create: `src/components/dashboard/TodayCard.tsx`
- Test: `tests/components/TodayCard.test.tsx`

Context: three rows — Spend ($), Tasks done (✓, green), Active agents. `spendToday` + `tasksCompletedToday` come from props (store stats); `activeAgents` count is computed by the caller from store agents (`health_status === "active"`) and passed in. Follow the existing card style in `src/components/dashboard/` (e.g. `KpiCard.tsx`) for container styling and CSS variables.

- [ ] **Step 1: Write the failing test**

Create `tests/components/TodayCard.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayCard } from "../../src/components/dashboard/TodayCard";

describe("TodayCard", () => {
  it("renders spend, tasks done, and active count", () => {
    render(<TodayCard spendToday={2.74} tasksCompletedToday={9} activeAgents={2} />);
    expect(screen.getByText("$2.74")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/Spend/i)).toBeInTheDocument();
    expect(screen.getByText(/Tasks done/i)).toBeInTheDocument();
    expect(screen.getByText(/Active agents/i)).toBeInTheDocument();
  });
});
```
(Match the render/import conventions in an existing `tests/components/*.test.tsx` — e.g. whether they import a custom `render` from a test-utils file. Adjust imports to match.)

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/TodayCard.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `TodayCard`**

```tsx
import { cardStyle, sectionHeader } from "../../styles/shared.js";

interface TodayCardProps {
  spendToday: number;
  tasksCompletedToday: number;
  activeAgents: number;
}

const rowStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "baseline",
  padding: "10px 0", borderBottom: "1px solid var(--border-subtle)",
};
const numStyle: React.CSSProperties = { fontSize: "26px", fontWeight: 700, color: "var(--text-primary)" };
const labelStyle: React.CSSProperties = { color: "var(--text-secondary)", fontSize: "12px" };

export function TodayCard({ spendToday, tasksCompletedToday, activeAgents }: TodayCardProps) {
  return (
    <div style={cardStyle}>
      <div style={{ ...sectionHeader, display: "flex", justifyContent: "space-between" }}>
        <span>Today</span><span style={labelStyle}>since midnight</span>
      </div>
      <div style={rowStyle}><span style={labelStyle}>Spend</span><span style={numStyle}>${spendToday.toFixed(2)}</span></div>
      <div style={rowStyle}><span style={labelStyle}>Tasks done</span><span style={{ ...numStyle, color: "var(--status-success)" }}>{tasksCompletedToday}</span></div>
      <div style={{ ...rowStyle, borderBottom: "none" }}><span style={labelStyle}>Active agents</span><span style={numStyle}>{activeAgents}</span></div>
    </div>
  );
}
```
**Before running:** confirm `cardStyle` / `sectionHeader` exports exist in `src/styles/shared` (DashboardView imports `cardStyle, sectionHeader, typeScale` from `../styles/shared.js`). If the CSS variable names differ (e.g. `--border-subtle`, `--status-success`), use the ones actually defined in the project's CSS — grep `src/` for `--status-success` and `--border` to confirm. Use real, existing variables.

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/TodayCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```powershell
git add src/components/dashboard/TodayCard.tsx tests/components/TodayCard.test.tsx
git commit -m "feat(2a): add TodayCard momentum tile"
```

---

## Task 5: Frontend — `LiveRosterCard` component

**Files:**
- Create: `src/components/dashboard/LiveRosterCard.tsx`
- Test: `tests/components/LiveRosterCard.test.tsx`

Context: renders agents from props. Active + idle agents as rich cards (sorted active first, then by most-recent `last_seen_at`); offline agents collapsed into an expandable footer. Uses `agent.health_status` (server-provided, already on store agents) for freshness, `relativeTime(agent.last_seen_at)` for the meta line, `agentColor(agent)` from `src/utils/agentColors` for the left border + dot, `ROLE_COLORS`/role for the pill, `agent.current_task_title` for the task line, `agent.completed_today` for the count. Progress bar comes from the agent's current in-progress task `progress`, looked up from the tasks passed in.

- [ ] **Step 1: Write the failing test**

Create `tests/components/LiveRosterCard.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LiveRosterCard } from "../../src/components/dashboard/LiveRosterCard";
import type { Agent, Task } from "../../src/types";

function agent(over: Partial<Agent>): Agent {
  return {
    id: "a", name: "coder-1", model: null, capabilities: [], role: "coder",
    parent_agent_id: null, registered_at: "2026-05-28T00:00:00Z",
    last_seen_at: new Date().toISOString(),
    health_status: "active", completed_today: 3, current_task_title: "Implementing X",
    ...over,
  } as Agent;
}

describe("LiveRosterCard", () => {
  it("renders an active agent's current task and completed-today", () => {
    render(<LiveRosterCard agents={[agent({})]} tasks={[]} />);
    expect(screen.getByText("coder-1")).toBeInTheDocument();
    expect(screen.getByText("Implementing X")).toBeInTheDocument();
    expect(screen.getByText(/3/)).toBeInTheDocument();
  });

  it("collapses offline agents into an expandable footer", () => {
    const agents = [
      agent({ id: "a", name: "active-1", health_status: "active" }),
      agent({ id: "b", name: "gone-1", health_status: "offline" }),
    ];
    render(<LiveRosterCard agents={agents} tasks={[]} />);
    expect(screen.queryByText("gone-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/offline/i));
    expect(screen.getByText("gone-1")).toBeInTheDocument();
  });

  it("shows an empty state when there are no agents", () => {
    render(<LiveRosterCard agents={[]} tasks={[]} />);
    expect(screen.getByText(/No agents registered/i)).toBeInTheDocument();
  });
});
```
(Adjust the `agent()` factory fields to match the real `Agent` type in `src/types`. Match the test-utils import convention used by neighboring component tests.)

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/LiveRosterCard.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `LiveRosterCard`**

```tsx
import { useState } from "react";
import type { Agent, Task } from "../../types";
import { cardStyle, sectionHeader } from "../../styles/shared.js";
import { agentColor } from "../../utils/agentColors";
import { HEALTH_COLORS } from "../../constants/colors.js";
import { relativeTime } from "../../utils/time";

interface LiveRosterCardProps {
  agents: Agent[];
  tasks: Task[];
}

function currentTask(agent: Agent, tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => t.assigned_agent_id === agent.id && t.status === "in_progress")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

const HEALTH_RANK: Record<string, number> = { active: 0, idle: 1, offline: 2 };

export function LiveRosterCard({ agents, tasks }: LiveRosterCardProps) {
  const [showOffline, setShowOffline] = useState(false);

  const sorted = [...agents].sort((a, b) => {
    const ra = HEALTH_RANK[a.health_status ?? "offline"] ?? 2;
    const rb = HEALTH_RANK[b.health_status ?? "offline"] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
  const live = sorted.filter((a) => a.health_status !== "offline");
  const offline = sorted.filter((a) => a.health_status === "offline");

  return (
    <div style={cardStyle}>
      <div style={{ ...sectionHeader, display: "flex", justifyContent: "space-between" }}>
        <span>Live Agents</span>
        <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>
          {live.filter((a) => a.health_status === "active").length} active · {live.filter((a) => a.health_status === "idle").length} idle
        </span>
      </div>

      {agents.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px 0" }}>No agents registered yet.</div>
      )}

      {live.map((a) => {
        const task = currentTask(a, tasks);
        const color = agentColor(a);
        const dot = HEALTH_COLORS[a.health_status ?? "offline"];
        return (
          <div key={a.id} style={{ borderLeft: `3px solid ${color}`, background: "var(--bg-elevated)", borderRadius: "6px", padding: "10px 12px", marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot }} />
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.name}</span>
              </span>
              <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "999px", background: "var(--bg-primary)", color: "var(--text-secondary)", textTransform: "uppercase" }}>{a.role}</span>
            </div>
            <div style={{ marginTop: "6px", color: a.current_task_title ? "var(--text-primary)" : "var(--text-muted)", fontSize: "13px" }}>
              {a.current_task_title ?? "— idle, no active task —"}
            </div>
            {task && (
              <div style={{ height: "4px", borderRadius: "2px", background: "var(--bg-primary)", overflow: "hidden", margin: "7px 0 6px" }}>
                <div style={{ height: "100%", width: `${task.progress}%`, background: "var(--accent-blue)" }} />
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: "11px", marginTop: task ? 0 : "6px" }}>
              <span>{a.health_status} · {relativeTime(a.last_seen_at)}</span>
              <span>✓ {a.completed_today ?? 0} today</span>
            </div>
          </div>
        );
      })}

      {offline.length > 0 && (
        <div>
          <div onClick={() => setShowOffline((v) => !v)} style={{ cursor: "pointer", textAlign: "center", color: "var(--text-muted)", fontSize: "11px", padding: "6px", border: "1px dashed var(--border-subtle)", borderRadius: "6px" }}>
            ▸ {offline.length} offline {showOffline ? "(hide)" : "(click to expand)"}
          </div>
          {showOffline && offline.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", opacity: 0.5, fontSize: "12px", padding: "4px 8px" }}>
              <span>{a.name}</span><span>{relativeTime(a.last_seen_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```
**Before running:** confirm these imports resolve to real exports — `agentColor` from `src/utils/agentColors` (grep confirms it exists), `HEALTH_COLORS` from `src/constants/colors` (confirmed used by AgentFeed). Confirm CSS vars `--bg-elevated`, `--bg-primary`, `--accent-blue`, `--border-subtle`, `--text-muted` exist; substitute the project's actual variable names where they differ (grep `src/` / the CSS for the real names). Confirm `Task.progress` and `Task.updated_at` exist on the `Task` type (they do per `shared/types.ts`).

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/LiveRosterCard.test.tsx`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**
```powershell
git add src/components/dashboard/LiveRosterCard.tsx tests/components/LiveRosterCard.test.tsx
git commit -m "feat(2a): add LiveRosterCard agent roster"
```

---

## Task 6: Frontend — wire the hero row into `DashboardView` + verify

**Files:**
- Modify: `src/components/DashboardView.tsx`
- Test: existing Dashboard tests + manual smoke

Context: insert the hero grid (65/35) directly under `<h2>Dashboard</h2>` (around line 144), above the KPI grid. Read agents + tasks from the store (the same selectors DashboardView already uses — `useDataState()` provides `tasks`; check whether it also provides `agents`, else use `useAppState()`), and stats (`spend_today`, `tasks_completed_today`) from the store stats slice.

- [ ] **Step 1: Identify the store selectors**

Grep `src/components/DashboardView.tsx` and `src/store.tsx` to confirm how to read `agents` and the stats slice from the store (DashboardView already calls `useDataState()`; `App.tsx` populates agents + stats). Note the exact hooks/fields.

- [ ] **Step 2: Add imports + hero row to `DashboardView`**

Add imports:
```typescript
import { LiveRosterCard } from "./dashboard/LiveRosterCard";
import { TodayCard } from "./dashboard/TodayCard";
```
Read agents + stats from the store via the selectors confirmed in Step 1. Compute the active count and insert the hero row immediately after the `<h2>Dashboard</h2>` element and before the KPI `<div>`:
```tsx
      <div style={{ display: "grid", gridTemplateColumns: "65fr 35fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <LiveRosterCard agents={agents} tasks={projectTasks} />
        <TodayCard
          spendToday={stats?.spend_today ?? 0}
          tasksCompletedToday={stats?.tasks_completed_today ?? 0}
          activeAgents={agents.filter((a) => a.health_status === "active").length}
        />
      </div>
```
Use `projectTasks` (already computed in DashboardView for the selected project) so the roster's progress bars reflect the current project scope; if you prefer all tasks, use the unfiltered `tasks`. Pick `projectTasks` for consistency with the rest of the view.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean. Fix any selector/type mismatches surfaced (e.g. if `stats` is possibly undefined, the `?? 0` guards handle it).

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: all pass (new component tests + existing Dashboard tests unaffected — the hero is additive).

- [ ] **Step 5: Manual smoke (the real proof)**
```powershell
npm run dev
```
Open http://localhost:3000 → Dashboard (Fleet → Overview). Verify:
- The hero row renders at the top: Live Agents (left) + Today (right), above the KPI cards.
- Active/idle agents show as cards with task + progress + freshness + "✓ N today"; offline agents are collapsed into the footer and expand on click.
- Today tile shows Spend / Tasks done / Active agents.
- With an MCP agent active (or by completing a task via the UI), the roster + Today figures update within a poll cycle (≤3s) — no manual refresh.
- No console errors; existing cards still render below the hero.
Stop the dev server.

- [ ] **Step 6: Static analysis + commit**
```powershell
semgrep --config=auto --error src/components/DashboardView.tsx src/components/dashboard/LiveRosterCard.tsx src/components/dashboard/TodayCard.tsx
git add src/components/DashboardView.tsx
git commit -m "feat(2a): mount Live Roster + Today hero on the Dashboard"
```

---

## Final Verification + Wrap-Up

- [ ] **Branch summary + full build/test**
```powershell
git log --oneline main..HEAD
npm run build
npm test
```

- [ ] **Update CLAUDE.md if warranted** — the Dashboard description in CLAUDE.md is high-level; only touch it if it explicitly enumerates Dashboard cards (it likely doesn't). Grep `CLAUDE.md` for "Dashboard" and update only if stale.

- [ ] **Code review** — invoke `superpowers:requesting-code-review`; address findings; touch `.claude/.last-code-review`.

- [ ] **Push + PR**
```powershell
git push -u origin feat/phase-2a-live-roster
gh pr create --base main --title "feat: Phase 2A — Dashboard live agent roster + Today tile" --body @'
## Summary
Adds the "what's happening now" hero to the Dashboard overview: a live agent roster (current task, progress, freshness, completed-today; offline agents collapsed) beside a Today tile (spend today, tasks done today, active agents). Built on existing data + the existing WebSocket/poll refresh — no schema change, no new MCP tool.

Backend: per-agent `completed_today` on `/api/agents`; `spend_today` + `tasks_completed_today` on `/api/stats` (UTC day, matching getAgentCompletedToday).
Frontend: `LiveRosterCard` + `TodayCard` composed into a hero row above the KPI strip; extracted shared `relativeTime` util.

Spec: docs/superpowers/specs/2026-05-28-dashboard-live-roster-design.md

## Test plan
- [ ] npm run build clean; npm test green (new component + data tests)
- [ ] Dashboard hero renders; active/idle cards + offline footer expand; Today figures correct
- [ ] Roster + Today update within a poll cycle as agents work
- [ ] No regressions to existing Dashboard cards

> security/snyk fails on a quota limit — skip per prior guidance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Notes
- **No `recurrence_rule`/orphan-schema interaction** — 2A is additive and unrelated to the 1D schema work.
- **Clean seam for 2C:** when `heartbeat` lands, `LiveRosterCard`'s task line can show an optional pushed status string with no structural change.
- **Approximate "time on task"** is intentionally omitted from the card meta in this plan (the spec allowed it but it adds derivation complexity); the freshness line (`health · relativeTime`) covers liveness. Add time-on-task later if desired.
