# Kanban Card Sharpening — Design (Phase 2B)

**Status:** Approved in brainstorm 2026-05-28. Ready for implementation planning.

**One-line:** Make the Kanban board more glanceable and alive — an enriched agent badge (freshness dot, front of row) for ownership at a glance, and a brief "just-changed" pulse when a card's status changes (incl. column moves) or a new card appears.

---

## Goal & Context

Second sharpening phase, after 2A (Dashboard Live Roster, PR #109). The Kanban board (`TaskBoard`) is a core surface for a solo user running multiple parallel agents. Two gaps:

1. **Ownership blends in.** `TaskCard` already shows the assigned agent as a small name badge colored by `agentColor(name)`, but it sits among priority/due/tag badges and is easy to miss when scanning a full board. The card's **left border is already status-owned** (active=green, blocked/overdue=red), so attribution needs a different affordance.
2. **The board feels static.** Updates arrive via the existing WebSocket + poll and re-render the board, but nothing draws the eye to *what just changed* — the difference between "a dashboard" and "a live system you trust."

**Success criteria:**
- Scanning the board, you can tell which agent owns each card (and whether that agent is active/idle) without reading the badge row carefully.
- When a card changes status / moves columns, or a new card appears, it briefly flashes so the change is noticeable.
- Card-only change; no backend, no new data, no drag/drop changes. Reuses existing animation + the `agent.health_status` field (exposed in 2A).

**Dependency:** builds on 2A's `Agent.health_status` type field. This branch is stacked on `feat/phase-2a-live-roster`; rebase onto main once #109 merges.

---

## Scope

**In scope (2B):**
- Enrich the agent badge in `src/components/TaskCard.tsx` (freshness dot + move to front).
- Add a "just-changed" pulse: per-card status-change flash + board-level new-card flash, reusing the existing `.highlight-pulse` CSS class; honor `prefers-reduced-motion`.

**Out of scope:**
- 2C (`heartbeat` / `get_project_context` MCP tools).
- Any backend / API / schema change.
- Drag-and-drop, column, or board-layout changes.
- Pulsing on progress ticks or field edits (deliberately excluded — see Decisions).

---

## Design Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Agent attribution treatment | **Option C — enrich the existing badge**: keep the `agentColor(name)` name badge, add a freshness dot (from `health_status`), move it to the **front** of the badges row. Minimal, low-risk. |
| Freshness dot colors | active = green (`--status-success`), idle = amber (`--status-warning`), offline = grey (`--text-muted`) — same mapping used elsewhere (`HEALTH_COLORS`). |
| Pulse trigger | **Status change (incl. column move) + new card.** NOT progress ticks or edits. |
| Pulse visual | Reuse existing `.highlight-pulse` (0.8s blue box-shadow ripple, already used by TopBar). |
| Accessibility | Respect `prefers-reduced-motion` — no pulse for users who opt out. |
| Mechanism split | Per-card `useRef`/effect for status-change (columns are statuses, so this covers column moves); board-level known-ID set for new-card detection. |

---

## Architecture

### 1. Enriched agent badge (`TaskCard.tsx`)

The existing block (TaskCard ~lines 228-235) renders:
```tsx
{assignedAgent && (
  <span style={badgeStyle(agentColor(assignedAgent.name))}>{assignedAgent.name}</span>
)}
```
Change it to:
- **Move first** in the badges row (render the agent badge before the priority/due badges).
- **Add a freshness dot** inside the badge: a small circle whose color comes from the agent's `health_status` (`active`→green, `idle`→amber, `offline`/undefined→grey), with a faint light ring so it reads against the vibrant `agentColor` background. `assignedAgent.health_status` is available because the board already passes `agents` (enriched by `/api/agents`) to `TaskCard`.
- Unassigned cards: unchanged (no badge).

This is presentational only — `assignedAgent` is already derived in `TaskCard` from the `agents` prop.

### 2. Just-changed pulse

Two complementary mechanisms, both applying the existing `.highlight-pulse` class for one 0.8s cycle, and both gated on `prefers-reduced-motion: no-preference`.

**a) Status-change pulse (per-card) — covers column moves.**
Because the board's columns ARE statuses (`COLUMNS` = planned / in_progress / blocked / done), moving a card between columns is a `status` change. A small hook encapsulates the behavior:
- `usePulseOnChange(value): boolean` — tracks the previous `value` in a `useRef`; on first run records it without pulsing; when `value` changes, returns `pulsing = true`, then clears it after 800ms (via `setTimeout`/state). Re-fires on each subsequent change.
- `TaskCard` calls `const statusPulse = usePulseOnChange(task.status)` and adds `.highlight-pulse` to the card's className when `statusPulse` is true.

**b) New-card pulse (board-level).**
A card can't tell "I'm new" from "initial board load" on its own, so this is detected at `TaskBoard`:
- `TaskBoard` keeps a `useRef<Set<string>>` of known task IDs across renders, plus a `useRef<boolean>` "initial render done" guard.
- On render: after the first render, any task ID present now but not in the known set is "just appeared." Compute a `justAppearedIds: Set<string>` for this cycle; then update the known set.
- `TaskBoard` passes `justAppearedIds` down to its children (`KanbanColumn`, `MilestoneGroup`), which forward a boolean `justAppeared={justAppearedIds.has(task.id)}` to each `TaskCard`.
- `TaskCard` pulses when `statusPulse || justAppeared`.

**Reduced-motion:** the pulse application checks `window.matchMedia("(prefers-reduced-motion: reduce)")`; when reduced motion is preferred, the `.highlight-pulse` class is not applied (cards still update content, just no flash). Encapsulate this check so both mechanisms share it (e.g. inside `usePulseOnChange` and the `justAppeared` application).

### Files
- Modify: `src/components/TaskCard.tsx` — enriched badge; consume `usePulseOnChange` + `justAppeared` prop; apply `.highlight-pulse`.
- Create: `src/hooks/usePulseOnChange.ts` (or co-locate) — the status-change hook + reduced-motion gate.
- Modify: `src/components/TaskBoard.tsx` — known-ID set + `justAppearedIds` computation, threaded to children.
- Modify: `src/components/board/KanbanColumn.tsx` and `src/components/board/MilestoneGroup.tsx` — accept `justAppearedIds` and pass `justAppeared` to each `TaskCard`.
- (No CSS change — `.highlight-pulse` already exists in `src/App.css`.)

---

## Data Flow
1. WebSocket/poll updates the store; `TaskBoard` re-renders with new `tasks` (existing behavior).
2. A card whose `task.status` differs from its previous render flashes (status/column-move pulse).
3. A task ID newly present on the board (after initial load) flashes (new-card pulse).
4. The enriched badge reads `assignedAgent.health_status` from the already-passed `agents`, so the freshness dot reflects the latest poll.
No new fetches, no new store fields.

---

## Testing
- **Badge:** `TaskCard` renders the agent badge first in the row with a freshness dot whose color matches `health_status` (active/idle/offline); unassigned card shows no badge.
- **Status pulse:** `usePulseOnChange` returns false on first render, true after the value changes, false again after the timeout; with `prefers-reduced-motion: reduce` it never returns the pulse (mock `matchMedia`). `TaskCard` gets `.highlight-pulse` when its `task.status` changes between renders, not on first mount.
- **New-card pulse:** `TaskBoard`'s `justAppearedIds` is empty on first render and contains a task ID that appears in a later render; a card with `justAppeared` gets the pulse.
- **No regression:** existing `TaskCard`/board tests pass; drag/drop, sub-tasks, status styling unaffected.

---

## Risks / Notes
- **`prefers-reduced-motion` must be honored** — a flashing board is an accessibility problem otherwise. Shared gate, tested with a mocked `matchMedia`.
- **Animation re-trigger:** `.highlight-pulse` is a one-shot CSS animation; to fire again on a later change, the class must be removed then re-added (the `pulsing` state going false→true between changes handles this; ensure the timeout reset logic re-arms correctly).
- **New-card threading** is the only cross-component plumbing (TaskBoard → KanbanColumn/MilestoneGroup → TaskCard). If it proves noisy in the plan, the status-change pulse alone still delivers most of the value (column moves are status changes); new-card could be a follow-up. Spec keeps both.
- **Clean seam for 2C:** unrelated; no interaction.

---

## Out-of-scope follow-ups
- **2C** — `heartbeat` MCP tool (richer per-agent status) + `get_project_context`.
