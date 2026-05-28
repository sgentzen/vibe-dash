# Dashboard Live Roster — Design (Phase 2A)

**Status:** Approved in brainstorm 2026-05-28. Ready for implementation planning.

**One-line:** Add a hero row to the top of the Dashboard overview that answers "what is each agent doing right now" — a live agent roster beside a compact "Today" momentum tile — using existing data and the existing real-time pipeline.

---

## Goal & Context

The cut effort (Phases 1A–1D, PRs #105–#108) slimmed vibe-dash to Dashboard + Kanban + Agents + MCP. This is the first **sharpening** phase: making the Dashboard a live ops view instead of a generic PM dashboard.

When the owner glances at the Dashboard, the primary question is **"what is each agent doing right now?"** — a roster of agents, their current work, and how fresh that work is. The existing Dashboard buries this (agent info is one card among many, and the dedicated Agent Dashboard lives behind a separate fleet preset). 2A promotes it to the hero.

**Success criteria:**
- Opening the Dashboard, within ~2 seconds you can see: which agents are active vs idle, what task each active agent is on (with progress), how recently each checked in, and how much was spent / completed today.
- No new background process, no new MCP tool, no schema change. Runs on existing data + the existing WebSocket/polling refresh.
- Existing Dashboard cards remain, just shifted below the new hero.

---

## Scope

**In scope (2A):**
- A new `LiveRosterCard` and `TodayCard`, composed into a hero row at the top of `DashboardView`.
- Two small server additions to supply data not currently exposed: per-agent **completed-today** and a **spend-today** figure.

**Explicitly out of scope (deferred):**
- `heartbeat` MCP tool / freeform agent status strings → **Phase 2C**. 2A shows the agent's current *assigned in-progress task* as "what it's doing", not a pushed status message.
- `get_project_context` MCP tool → Phase 2C.
- Kanban per-card agent attribution + "just-changed" pulse → **Phase 2B**.
- Burn-rate ($/hr) math → intentionally dropped (the Today tile shows cumulative figures only; see Decisions).

---

## Design Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| Primary job | "What is each agent doing right now" — presence + current work |
| Per-agent presentation | **Rich card** (option B): colored left border + freshness dot, name, role pill, current task title + progress bar, freshness/time-on-task, completed-today |
| Layout | **L2 hero split**: roster (left ~65%) + Today tile (right ~35%), placed **above** the existing KPI strip; all existing cards shift down |
| Roster membership | **Active + idle agents as full cards** (sorted active→idle); **offline agents collapsed** into an expandable `▸ N offline` footer |
| Today tile | **Spend today + tasks done today + active agent count** — cumulative, **no rate** (bursty cost logging makes a rolling $/hr misleading) |
| Freshness model | Reuse existing `getAgentHealthStatus` + `ACTIVE_THRESHOLD_MS` / `IDLE_THRESHOLD_MS` thresholds |
| Real-time | Reuse the existing WebSocket + 3s polling that already drives the Dashboard. No pulse animation in 2A (that's 2B) |
| Implementation approach | **Hybrid** — assemble the roster client-side from existing store state; add only the two missing data bits server-side |

---

## Architecture

### Frontend (the bulk of 2A)

Two new presentational components under `src/components/dashboard/`, composed into the existing `DashboardView`:

**`LiveRosterCard`**
- **Input (props):** the agents already in the store (`useDataState().agents`), the tasks in the store (to find each agent's current in-progress task + its `progress`), and per-agent `completed_today` (from the new server field — see below). Agent color from the existing `src/utils/agentColors` util.
- **Per-agent card:** left border in the agent's color; freshness dot (green active / amber idle); name; role pill; current in-progress task title (or "— idle, no active task —"); a thin progress bar bound to that task's `progress`; a meta line `active 30s ago · Nm on task` and `✓ N today`.
- **Current task derivation:** the in-progress task assigned to the agent — `tasks.find(t => t.assigned_agent_id === agent.id && t.status === "in_progress")`. If several, pick the most recently updated. Progress = that task's `progress`. "time on task" = now − that task's `updated_at` when it entered in_progress (approximate via `updated_at`; acceptable — exact in-progress-since tracking is out of scope).
- **Freshness:** compute active/idle/offline from `agent.last_seen_at` using the same thresholds the server uses. Expose the threshold constants to the client (they're already exported as `ACTIVE_THRESHOLD_MINUTES`; mirror idle threshold as a shared constant) so client and server agree. Reuse any existing client health helper (`AgentDashboard` already renders health — factor out a shared helper if one isn't already shared).
- **Membership:** render active + idle agents as full cards, sorted active-first then by most-recent `last_seen_at`. Offline agents are counted and rendered as a single expandable footer row `▸ N offline (click to expand)`; expanding lists them as dimmed compact lines (name + last-seen). Collapsed by default.
- **Empty states:** no agents at all → "No agents registered yet"; agents exist but none active/idle → still show idle/offline appropriately (the footer + any idle cards).

**`TodayCard`** — three rows: Spend ($), Tasks done (✓, green), Active agents; label "since midnight" (server-local day). Each value is sourced as the simplest correct option:
- **Active agents** — computed **client-side** from store state: count of agents whose freshness is `active`. No server data needed.
- **Spend today** — **new server figure** `spend_today` (sum of `cost_entries.cost_usd` where `created_at >= start-of-local-day`).
- **Tasks done today** — **new server figure** `tasks_completed_today` (count of tasks completed today). Note: this is a *project/global* count, distinct from the per-agent `completed_today` shown on roster cards — it also captures completions not attributed to an agent. Do not derive it by summing per-agent counts.

**`DashboardView` change:** insert a hero `<div>` (CSS grid `65fr 35fr`) containing `<LiveRosterCard/>` + `<TodayCard/>` immediately under the `<h2>Dashboard</h2>`, above the existing KPI grid. No existing card is removed.

### Backend (minimal additions)

The roster's identity/task/freshness data is already in the store. Three figures are missing (all read-only, no schema change, no new table):

1. **Per-agent `completed_today`** (for roster cards) — `getAgentCompletedToday(db, agentId)` **already exists** in `server/db/agents.ts`. Expose it: include `completed_today` on the agent objects returned by the agents listing endpoint. Prefer extending the existing agents response over a new endpoint.
2. **`spend_today`** (for Today tile) — sum of `cost_entries.cost_usd` where `created_at >= start-of-local-day`.
3. **`tasks_completed_today`** (for Today tile) — count of tasks completed today (project/global, not per-agent).

Deliver (2) and (3) as fields on whatever summary response the Dashboard already fetches on load + poll (the existing stats/cost call), to avoid a new endpoint. The exact host endpoint is finalized in the implementation plan; the constraint is **least new surface — extend existing responses over inventing new ones.**

---

## Data Flow

1. On load + every poll tick + on relevant WebSocket events (`agent_activity`, `agent_registered`, `task_updated`, `task_completed`, `cost_logged`), the store already refreshes agents/tasks/cost.
2. `LiveRosterCard` recomputes the roster from store state (pure derivation — no fetch of its own).
3. Per-agent `completed_today` (roster) and the `spend_today` / `tasks_completed_today` summary figures (Today tile) arrive via the extended agents/stats responses the Dashboard already calls.
4. Freshness and the active-agent count are recomputed on each render from `last_seen_at` vs the shared thresholds, so cards drift active→idle→offline naturally as time passes between polls.

No new client fetch hook is required if the three fields ride on responses the Dashboard already requests; otherwise one additional `useApi` call wired into the existing load + poll path.

---

## Testing

- **Component tests** (Vitest + the existing `tests/components/` setup): `LiveRosterCard` renders active/idle cards with the right task + progress + freshness; sorts active-first; collapses offline into the footer and expands on click; empty state with no agents. `TodayCard` renders the three figures and the "since midnight" label.
- **Freshness boundary:** a unit test that an agent crosses active→idle→offline as `last_seen_at` ages past the thresholds (using fixed clock inputs).
- **Server additions:** integration tests (in-memory DB) for `spend_today` (only today's cost entries counted, across the local-day boundary) and that `completed_today` is surfaced on the agents response.
- **No regressions:** existing Dashboard tests still pass; the existing cards still render below the hero.

---

## Risks / Notes

- **"Time on task" is approximate** (derived from task `updated_at`, not a true in-progress-since timestamp). Acceptable for 2A; a precise field is out of scope.
- **Local-day boundary** for "today": compute start-of-day server-side in the server's local timezone, consistent with how existing daily stats are bucketed. Document the chosen reference in the plan.
- **Bursty cost** is why the Today tile is cumulative, not a rate — by design.
- 2A deliberately leaves a clean seam for 2C: when `heartbeat` lands, the roster card's "current task title" line can gain an optional pushed-status string without restructuring.

---

## Out-of-scope follow-ups (future phases)
- **2B** — Kanban per-card agent attribution + just-changed pulse.
- **2C** — `heartbeat` MCP tool (richer roster status) + `get_project_context` aggregator.
