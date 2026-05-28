# Kanban Card Sharpening Implementation Plan (Phase 2B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kanban cards glanceable (enriched agent badge with a freshness dot, moved to the front) and alive (a brief `.highlight-pulse` flash when a card's status changes or a new card appears).

**Architecture:** Frontend-only, card-centric. A small `usePulseOnChange` hook drives the status-change flash inside `TaskCard` (columns ARE statuses, so this covers column moves). New-card detection is computed once at `TaskBoard` (a known-ID set) and threaded down as a per-card `justAppeared` boolean. Reuses the existing `.highlight-pulse` CSS class and the `agent.health_status` field (typed in 2A). No backend, no new data, honors `prefers-reduced-motion`.

**Tech Stack:** React 19, TypeScript strict, Vitest + @testing-library/react, ESM (`.js` import extensions in source).

**Spec:** `docs/superpowers/specs/2026-05-28-kanban-card-sharpening-design.md`
**Branch:** `feat/phase-2b-kanban-cards` (stacked on `feat/phase-2a-live-roster`, which provides `Agent.health_status`).

---

## File Structure
- Create: `src/hooks/usePulseOnChange.ts` — hook: true for 800ms after a value changes (not first mount), gated by `prefers-reduced-motion`.
- Create: `src/utils/boardPulse.ts` — pure helper `newlyAppearedIds(known, current)` for new-card detection (unit-testable without rendering the board).
- Modify: `src/components/TaskCard.tsx` — enriched agent badge (freshness dot, front of row); apply `.highlight-pulse` via the hook + a new `justAppeared` prop.
- Modify: `src/components/TaskBoard.tsx` — compute `justAppearedIds` (known-ID ref + first-render guard) and pass to `KanbanColumn`.
- Modify: `src/components/board/KanbanColumn.tsx` — accept `justAppearedIds`, forward to `MilestoneGroup` and to each direct `TaskCard` as `justAppeared`.
- Modify: `src/components/board/MilestoneGroup.tsx` — accept `justAppearedIds`, forward `justAppeared` per `TaskCard`.
- Tests: `tests/components/usePulseOnChange.test.tsx`, `tests/components/boardPulse.test.ts`, and TaskCard tests (create or extend `tests/components/TaskCard.test.tsx`).
- No CSS change — `.highlight-pulse` already exists in `src/App.css`.

---

## Pre-Flight
- [ ] **Confirm branch + baseline**
```powershell
git branch --show-current   # feat/phase-2b-kanban-cards
npm test                    # record count
npm run build               # clean
```
- [ ] **Check for an existing TaskCard test**
```powershell
Test-Path tests/components/TaskCard.test.tsx
```
If it exists, you'll EXTEND it (add describe blocks); if not, CREATE it with the fixture helper shown in Task 2. Either way the test code below is what to add.

---

## Task 1: `usePulseOnChange` hook (with reduced-motion gate)

**Files:**
- Create: `src/hooks/usePulseOnChange.ts`
- Test: `tests/components/usePulseOnChange.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/components/usePulseOnChange.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePulseOnChange } from "../../src/hooks/usePulseOnChange";

describe("usePulseOnChange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // default: motion allowed
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("is false on first render and after an unchanged rerender", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    expect(result.current).toBe(false);
    rerender({ v: "planned" });
    expect(result.current).toBe(false);
  });

  it("becomes true when the value changes, then false after 800ms", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    rerender({ v: "in_progress" });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current).toBe(false);
  });

  it("does not pulse when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    rerender({ v: "in_progress" });
    expect(result.current).toBe(false);
  });
});
```
If `renderHook` is not exported by the installed `@testing-library/react` version, render a tiny probe component instead (`function Probe({v}){ return <span>{String(usePulseOnChange(v))}</span> }`) and assert its text. Check the version first.

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/usePulseOnChange.test.tsx`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/usePulseOnChange.ts`:
```ts
import { useEffect, useRef, useState } from "react";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Returns true for ~`durationMs` after `value` changes — never on first mount.
 * No-ops (stays false) when the user prefers reduced motion.
 */
export function usePulseOnChange<T>(value: T, durationMs = 800): boolean {
  const prev = useRef<T | undefined>(undefined);
  const initialized = useRef(false);
  const [pulsing, setPulsing] = useState(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      prev.current = value;
      return;
    }
    if (Object.is(prev.current, value)) return;
    prev.current = value;
    if (prefersReducedMotion()) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), durationMs);
    return () => clearTimeout(t);
  }, [value, durationMs]);

  return pulsing;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/usePulseOnChange.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Build + commit**
```powershell
npm run build
semgrep --config=auto --error src/hooks/usePulseOnChange.ts
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add src/hooks/usePulseOnChange.ts tests/components/usePulseOnChange.test.tsx
git commit -m "feat(2b): add usePulseOnChange hook (reduced-motion aware)"
```

---

## Task 2: Enriched agent badge in `TaskCard`

**Files:**
- Modify: `src/components/TaskCard.tsx`
- Test: `tests/components/TaskCard.test.tsx` (create or extend)

Context: `TaskCard` already computes `assignedAgent` from the `agents` prop and renders it as the agent badge (~lines 229-235):
```tsx
{assignedAgent && (
  <span style={badgeStyle(agentColor(assignedAgent.name))}>{assignedAgent.name}</span>
)}
```
This sits AFTER the priority/due badges in the badges row. We (a) move it to the FRONT of that row and (b) add a freshness dot from `assignedAgent.health_status`.

- [ ] **Step 1: Write the failing test**

Add to `tests/components/TaskCard.test.tsx` (create the file with this skeleton if absent — adapt the fixture to the real `Task`/`Agent` types in `src/types`):
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TaskCard } from "../../src/components/TaskCard";
import type { Task, Agent } from "../../src/types";

const noop = () => {};
function task(over: Partial<Task>): Task {
  return {
    id: "t1", project_id: "p", parent_task_id: null, milestone_id: null,
    assigned_agent_id: "a1", title: "Build it", description: null,
    status: "in_progress", priority: "high", progress: 50,
    due_date: null, start_date: null, estimate: null, task_type: null,
    created_at: "2026-05-28T00:00:00Z", updated_at: "2026-05-28T00:00:00Z",
    ...over,
  } as Task;
}
function agent(over: Partial<Agent>): Agent {
  return {
    id: "a1", name: "claude-coder", model: null, capabilities: [], role: "coder",
    parent_agent_id: null, registered_at: "2026-05-28T00:00:00Z",
    last_seen_at: "2026-05-28T00:00:00Z", health_status: "active",
    ...over,
  } as Agent;
}
function renderCard(t: Task, agents: Agent[]) {
  return render(
    <TaskCard task={t} allTasks={[t]} activity={[]} agents={agents}
      onClick={noop} onDragStart={noop} />
  );
}

describe("TaskCard agent badge", () => {
  it("renders the assigned agent with a freshness dot (active=green)", () => {
    renderCard(task({}), [agent({ health_status: "active" })]);
    const badge = screen.getByTestId("agent-badge");
    expect(badge).toHaveTextContent("claude-coder");
    const dot = within(badge).getByTestId("agent-fresh-dot");
    expect(dot).toHaveStyle({ background: "var(--status-success)" });
  });

  it("renders no agent badge when unassigned", () => {
    renderCard(task({ assigned_agent_id: null }), []);
    expect(screen.queryByTestId("agent-badge")).not.toBeInTheDocument();
  });

  it("places the agent badge before the priority badge", () => {
    renderCard(task({ priority: "high" }), [agent({})]);
    const badge = screen.getByTestId("agent-badge");
    const pri = screen.getByText("high");
    // agent badge comes earlier in document order than the priority pill
    expect(badge.compareDocumentPosition(pri) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
```
(Confirm `@testing-library/jest-dom` matchers like `toHaveStyle`/`toHaveTextContent` are set up — other component tests use them; if not, assert via `getAttribute`/`style.background`.)

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/TaskCard.test.tsx`
Expected: FAIL — no `agent-badge` testid / dot yet.

- [ ] **Step 3: Add a freshness-color helper usage + move the badge to the front**

In `src/components/TaskCard.tsx`:

a. Import the health colors (top of file, alongside existing imports):
```tsx
import { HEALTH_COLORS } from "../constants/colors.js";
```
(`HEALTH_COLORS` is `Record<AgentHealthStatus, string>` with CSS-var values — already used by `AgentFeed`.)

b. REMOVE the existing agent badge block from its current position (the `{assignedAgent && (...)}` after the due-date badges).

c. INSERT a new agent badge as the FIRST child of the badges row `<div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>` (before the priority badge):
```tsx
          {/* Assigned agent badge (with freshness dot) */}
          {assignedAgent && (
            <span
              data-testid="agent-badge"
              style={{ ...badgeStyle(agentColor(assignedAgent.name)), display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <span
                data-testid="agent-fresh-dot"
                aria-hidden="true"
                style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: HEALTH_COLORS[assignedAgent.health_status ?? "offline"],
                  boxShadow: "0 0 0 1px rgba(255,255,255,0.45)", flexShrink: 0,
                }}
              />
              {assignedAgent.name}
            </span>
          )}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/TaskCard.test.tsx`
Expected: PASS. If the order test fails, ensure the agent block is literally the first element inside the badges-row div.

- [ ] **Step 5: Build + commit**
```powershell
npm run build
semgrep --config=auto --error src/components/TaskCard.tsx
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add src/components/TaskCard.tsx tests/components/TaskCard.test.tsx
git commit -m "feat(2b): enrich Kanban agent badge with freshness dot, move to front"
```

### Constraints
- Use `HEALTH_COLORS` (real export) — active→`--status-success`, idle→`--status-warning`, offline→`--text-muted`. Fall back to `"offline"` when `health_status` is undefined.
- Don't change the left-border/status styling. Unassigned cards render no badge.

---

## Task 3: Status-change pulse in `TaskCard`

**Files:**
- Modify: `src/components/TaskCard.tsx`
- Test: `tests/components/TaskCard.test.tsx` (extend)

- [ ] **Step 1: Write the failing test**

Add to `tests/components/TaskCard.test.tsx`:
```tsx
import { vi, beforeEach, afterEach } from "vitest";

describe("TaskCard just-changed pulse (status)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("adds highlight-pulse when status changes between renders, not on first render", () => {
    const t = task({ status: "planned" });
    const { container, rerender } = render(
      <TaskCard task={t} allTasks={[t]} activity={[]} agents={[agent({})]} onClick={noop} onDragStart={noop} />
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("highlight-pulse");
    const t2 = task({ status: "in_progress" });
    rerender(
      <TaskCard task={t2} allTasks={[t2]} activity={[]} agents={[agent({})]} onClick={noop} onDragStart={noop} />
    );
    expect((container.firstElementChild as HTMLElement).className).toContain("highlight-pulse");
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/TaskCard.test.tsx -t "pulse"`
Expected: FAIL — no `highlight-pulse` class applied.

- [ ] **Step 3: Wire the hook into TaskCard**

In `src/components/TaskCard.tsx`:

a. Import the hook:
```tsx
import { usePulseOnChange } from "../hooks/usePulseOnChange";
```

b. Inside the component (near the other derived values), add:
```tsx
  const statusPulse = usePulseOnChange(task.status);
```

c. Add a `className` to the root `<div>` (it currently has none). The root div is the one with `draggable`, `onDragStart`, etc. Add:
```tsx
      className={statusPulse ? "highlight-pulse" : undefined}
```
(Place it among the existing props on that root `<div>`; keep all existing props/styles.)

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/TaskCard.test.tsx`
Expected: PASS (badge tests + pulse test).

- [ ] **Step 5: Build + commit**
```powershell
npm run build
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add src/components/TaskCard.tsx tests/components/TaskCard.test.tsx
git commit -m "feat(2b): pulse Kanban card on status change (column move)"
```

### Note
`.highlight-pulse` animates `box-shadow`; CSS animations override the card's inline `boxShadow` for the 0.8s duration, then it reverts. This is the intended brief flash. No CSS edit needed.

---

## Task 4: New-card pulse (board-level detection + threading)

**Files:**
- Create: `src/utils/boardPulse.ts`
- Test: `tests/components/boardPulse.test.ts`
- Modify: `src/components/TaskBoard.tsx`, `src/components/board/KanbanColumn.tsx`, `src/components/board/MilestoneGroup.tsx`, `src/components/TaskCard.tsx`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `tests/components/boardPulse.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newlyAppearedIds } from "../../src/utils/boardPulse";

describe("newlyAppearedIds", () => {
  it("returns ids present now but not in the known set", () => {
    const known = new Set(["a", "b"]);
    const res = newlyAppearedIds(known, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect([...res]).toEqual(["c"]);
  });
  it("returns empty when nothing is new", () => {
    const known = new Set(["a", "b"]);
    expect(newlyAppearedIds(known, [{ id: "a" }]).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run: `npx vitest run tests/components/boardPulse.test.ts`
Expected: FAIL — helper does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `src/utils/boardPulse.ts`:
```ts
/** IDs present in `current` but not in `known`. Used to flag brand-new cards. */
export function newlyAppearedIds(known: Set<string>, current: { id: string }[]): Set<string> {
  const out = new Set<string>();
  for (const item of current) {
    if (!known.has(item.id)) out.add(item.id);
  }
  return out;
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run tests/components/boardPulse.test.ts`
Expected: PASS.

- [ ] **Step 5: Compute `justAppearedIds` in `TaskBoard`**

In `src/components/TaskBoard.tsx`:

a. Imports:
```tsx
import { useRef, useMemo, useEffect } from "react";  // merge with existing react imports
import { newlyAppearedIds } from "../utils/boardPulse";
```
(Merge `useRef`/`useMemo`/`useEffect` into the existing `react` import line rather than duplicating.)

b. Inside `TaskBoard`, after `tasks` is available, add:
```tsx
  const knownTaskIdsRef = useRef<Set<string>>(new Set());
  const boardInitializedRef = useRef(false);
  const justAppearedIds = useMemo(
    () => (boardInitializedRef.current ? newlyAppearedIds(knownTaskIdsRef.current, tasks) : new Set<string>()),
    [tasks]
  );
  useEffect(() => {
    boardInitializedRef.current = true;
    knownTaskIdsRef.current = new Set(tasks.map((t) => t.id));
  }, [tasks]);
```
(`tasks` is the full task list already in scope — it's passed to `KanbanColumn` as `allTasks={tasks}`.)

c. Pass `justAppearedIds` to each `KanbanColumn` (the `COLUMNS.map(... <KanbanColumn ... />)` block):
```tsx
            justAppearedIds={justAppearedIds}
```

- [ ] **Step 6: Thread through `KanbanColumn`**

In `src/components/board/KanbanColumn.tsx`:
- Add `justAppearedIds: Set<string>;` to its props interface.
- Pass `justAppearedIds={justAppearedIds}` to `<MilestoneGroup ... />`.
- For the direct `tasks.map((task) => <TaskCard ... />)` branch, add `justAppeared={justAppearedIds.has(task.id)}` to `<TaskCard>`.

- [ ] **Step 7: Thread through `MilestoneGroup`**

In `src/components/board/MilestoneGroup.tsx`:
- Add `justAppearedIds: Set<string>;` to its props interface.
- In its `tasks.map((task) => <TaskCard ... />)`, add `justAppeared={justAppearedIds.has(task.id)}`.

- [ ] **Step 8: Consume `justAppeared` in `TaskCard`**

In `src/components/TaskCard.tsx`:
- Add `justAppeared?: boolean;` to `TaskCardProps`.
- Destructure it in the component signature.
- Combine with the status pulse on the root `<div>` className:
```tsx
      className={(statusPulse || justAppeared) ? "highlight-pulse" : undefined}
```

- [ ] **Step 9: Add a TaskCard test for `justAppeared`**

Add to `tests/components/TaskCard.test.tsx`:
```tsx
it("adds highlight-pulse when justAppeared is true", () => {
  const t = task({});
  const { container } = render(
    <TaskCard task={t} allTasks={[t]} activity={[]} agents={[agent({})]} justAppeared onClick={noop} onDragStart={noop} />
  );
  expect((container.firstElementChild as HTMLElement).className).toContain("highlight-pulse");
});
```

- [ ] **Step 10: Build + full test + commit**
```powershell
npm run build
npm test
semgrep --config=auto --error src/utils/boardPulse.ts src/components/TaskBoard.tsx src/components/board/KanbanColumn.tsx src/components/board/MilestoneGroup.tsx src/components/TaskCard.tsx
New-Item -ItemType File -Force -Path .claude/.last-code-review | Out-Null
git add -A
git status
git commit -m "feat(2b): pulse brand-new Kanban cards on appearance"
```

### Constraints
- `justAppearedIds` is recomputed per render but only AFTER the first render (guard), so initial board load does NOT flash every card.
- `justAppeared` is a transient prop (true only on the render where the card first appears); combined with the one-shot `.highlight-pulse`, it fires once. Don't add extra state for it in TaskCard.
- Threading is additive — don't change existing KanbanColumn/MilestoneGroup behavior.

---

## Final Verification + PR

- [ ] **Branch summary + full build/test**
```powershell
git log --oneline feat/phase-2a-live-roster..HEAD
npm run build
npm test
```

- [ ] **Manual smoke (best-effort).** `npm run dev` → open the board (Board view). Confirm: every assigned card shows the agent badge first with a colored freshness dot; moving a task between columns (drag, or complete a task) briefly flashes the card; a newly created task flashes on appearance; with OS "reduce motion" on, no flashing. (If the dev preview won't mount reliably in a headless harness, rely on the component tests + a local human check — note it in the PR.)

- [ ] **Code review** — invoke `superpowers:requesting-code-review`; address findings; touch `.claude/.last-code-review`.

- [ ] **CLAUDE.md** — no change expected (high-level component list only); grep to confirm.

- [ ] **Push + PR (base = the 2A branch while #109 is open; retarget to main after it merges)**
```powershell
git push -u origin feat/phase-2b-kanban-cards
gh pr create --base feat/phase-2a-live-roster --title "feat: Phase 2B — Kanban agent badge + just-changed pulse" --body @'
## Summary
Sharpens Kanban cards: the assigned-agent badge moves to the front of the badge row and gains a freshness dot (from health_status), and cards briefly flash (reusing .highlight-pulse) when their status changes (incl. column moves) or a new card appears. Reduced-motion is honored. Frontend-only; no backend/data change.

- usePulseOnChange hook (reduced-motion aware) drives the status-change flash in TaskCard
- newlyAppearedIds + a TaskBoard known-ID set drive the new-card flash, threaded to TaskCard
- Enriched agent badge in TaskCard

Stacked on #109 (needs Agent.health_status). Spec: docs/superpowers/specs/2026-05-28-kanban-card-sharpening-design.md

## Test plan
- [ ] npm run build clean; npm test green (hook, boardPulse, TaskCard tests)
- [ ] Board: agent badge first + freshness dot; status change/column move flashes; new card flashes; reduce-motion disables flashing
- [ ] No regression to drag/drop, sub-tasks, status styling

> security/snyk fails on a quota limit — skip per prior guidance.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
'@
```

---

## Notes
- **New-card threading (Task 4) is the only cross-component plumbing.** If it's deemed not worth it, Tasks 1-3 (badge + status/column-move pulse) stand alone and deliver most of the value. Keeping it per the spec.
- **Clean seam for 2C:** unrelated.
