# MCP Heartbeat + Project Context — Design (Phase 2C)

**Status:** Approved in brainstorm 2026-05-28. Ready for implementation planning.

**One-line:** Add two MCP tools — `heartbeat` (an agent reports a freeform "what I'm doing now" status) and `get_project_context` (one-call orientation) — store the status on the agent, and surface it in the Live Roster.

---

## Goal & Context

Final sharpening phase, after the Dashboard Live Roster (2A) and Kanban polish (2B). Two gaps for an agent-driven workflow:

1. **The roster infers, it doesn't know.** The Live Roster (2A) shows each agent's current *in-progress task title* — useful, but coarse. A `heartbeat` lets an agent push a more granular status ("running test suite (337 tests)") that's truer to "what's happening right now." Agents already passively report liveness (`last_seen_at` is touched on every MCP call); `heartbeat` adds the *what*, not just the *when*.
2. **Orientation takes many calls.** An agent joining a project must call `list_milestones` + `list_tasks` + blockers + activity to understand state. `get_project_context(project_id)` returns that in one focused payload.

**Success criteria:**
- An agent can call `heartbeat("...")` and the Live Roster shows that status (with its age), falling back to the in-progress task title when there's no recent heartbeat.
- An agent can call `get_project_context(project_id)` and get the current milestone(s) + in-progress tasks + active blockers + recent activity in one response.
- No auth (MCP runs unauthenticated post-1C); `get_project_context` is read-only; additive schema (no existing data affected).

**Dependencies:** builds on 2A's `Agent` enrichment + `LiveRosterCard` (both in `main`). Independent of 2B. Branch off `main`.

---

## Scope

**In scope (2C):**
- `heartbeat` MCP tool + `current_status`/`current_status_at` columns on `agents` (migration 016).
- `get_project_context` MCP tool (read-only aggregator).
- Surface `current_status`/`current_status_at` on `/api/agents` + the `Agent` type, and render the status in `LiveRosterCard` (fallback to task title).

**Out of scope:**
- Any other MCP tools; Kanban or Dashboard changes beyond the roster status line; auth; auto-expiry/clearing of stale status (the roster shows age instead).
- `heartbeat` carrying task_id / progress (decided against — status string only).

---

## Design Decisions (from brainstorm)

| Decision | Choice |
|---|---|
| `heartbeat` shape | `heartbeat(status: string)` — freeform; **latest-wins**, stored on the agent. |
| Status storage | New `current_status TEXT` + `current_status_at TEXT` columns on `agents` (migration 016). Nullable; existing agents unaffected. No auto-clear. |
| `get_project_context` input | `project_id: string` (required). |
| `get_project_context` payload | **Focused orientation**: `{ project, open_milestones: [{...milestone, progress}], in_progress_tasks, active_blockers, recent_activity (last ~10) }`. Read-only. |
| Roster surfacing | `LiveRosterCard` shows `current_status` (with age from `current_status_at`) when present; **falls back to the in-progress task title** otherwise. |

---

## Architecture

### 1. Storage — migration 016
Append a migration to `server/db/migrator.ts` (highest is currently `015`):
```sql
ALTER TABLE agents ADD COLUMN current_status TEXT;
ALTER TABLE agents ADD COLUMN current_status_at TEXT;
```
(SQLite has no multi-column ADD; two `ALTER TABLE ... ADD COLUMN` statements. Both nullable — existing rows get NULL. Follows the existing `{ name, run(db) }` migration pattern.)

### 2. `heartbeat` tool
- **Schema (shared/schemas.ts + server.ts registration):** `{ status: z.string() }` (optionally `.min(1).max(280)` to bound it). Register in `server/mcp/server.ts` via `server.tool("heartbeat", "Report what you're working on right now", schema, call("heartbeat"))`.
- **Handler (server/mcp/tools.ts):** resolves the calling agent (the `agentName` passed through `handleTool`, same as other tools), calls a new `setAgentStatus(db, agentName, status)` DB helper that sets `current_status = status`, `current_status_at = now()` on the agent row. Returns `ok({ success: true })`. The `call()` wrapper already touches `last_seen_at`, so a heartbeat also marks the agent active.
- **DB helper (server/db/agents.ts):** `setAgentStatus(db, agentName, status): void` — `UPDATE agents SET current_status = ?, current_status_at = ? WHERE name_normalized = ?` (use the existing name-normalization the other agent fns use). Broadcast an `agent_*` WebSocket event so the roster updates live? The roster already refreshes via the 3s poll; a broadcast is optional. Decision: reuse the existing `agent_registered`/poll path — emit the standard agent update if there's a clean existing event, else rely on the poll (the plan picks the least-surface option; do NOT invent a new WS event type unless trivially warranted).

### 3. `get_project_context` tool
- **Schema:** `{ project_id: z.string() }`. Register in `server.ts`.
- **Handler/helper:** a new `getProjectContext(db, projectId)` (small new module e.g. `server/db/projectContext.ts`, or added to an existing read module) that composes existing functions:
  - `project` — from `listProjects`/a get-by-id (find the project).
  - `open_milestones` — `listMilestones(db, projectId)` filtered to `status === "open"`, each with `getMilestoneProgress(db, milestone.id)`.
  - `in_progress_tasks` — `listTasks(db, { project_id, status: "in_progress" })`.
  - `active_blockers` — `getActiveBlockers(db)` filtered to this project's tasks (or a project-scoped variant if cleaner).
  - `recent_activity` — `getRecentActivity(db, ...)` scoped to the project, last ~10.
  Returns the assembled object via `ok(...)`. Read-only — no mutations, no broadcast. If `project_id` doesn't exist, return a clear error (e.g. `ok({ error: "project not found" })` or throw — match how other tools handle missing entities).

### 4. Surface status in the Live Roster
- `server/routes/agents.ts` (`GET /api/agents` enriched map): include `current_status` and `current_status_at` (already on the agent row after migration — they come through `listAgents` / the row spread; confirm `listAgents` selects `*` so they're present, else add them).
- `shared/types.ts`: `Agent` gains `current_status?: string | null` and `current_status_at?: string | null`.
- `src/components/dashboard/LiveRosterCard.tsx`: the agent's "doing" line shows `agent.current_status` when present (and optionally its age via `relativeTime(current_status_at)`), **falling back to `current_task_title`** (current behavior) when there's no status. Keep the existing freshness dot + completed-today.

### Files
- Modify: `server/db/migrator.ts` (migration 016)
- Modify: `server/db/agents.ts` (`setAgentStatus`; ensure status cols surfaced)
- Create: `server/db/projectContext.ts` (`getProjectContext`) — or add to an existing read module
- Modify: `server/db/index.ts` (barrel exports for the new helpers)
- Modify: `server/mcp/tools.ts` (HANDLERS: `heartbeat`, `get_project_context`)
- Modify: `server/mcp/server.ts` (register both tools)
- Modify: `shared/schemas.ts` (Zod schemas for both)
- Modify: `server/routes/agents.ts` (surface `current_status`/`current_status_at`)
- Modify: `shared/types.ts` (`Agent` + the context payload type if shared)
- Modify: `src/components/dashboard/LiveRosterCard.tsx` (render status w/ fallback)

---

## Data Flow
1. Agent calls `heartbeat("running tests")` → handler → `setAgentStatus` writes `current_status`/`current_status_at`; `call()` wrapper touches `last_seen_at`.
2. The Dashboard's existing 3s poll re-fetches `/api/agents` (now carrying `current_status`); `LiveRosterCard` shows the status line.
3. Agent calls `get_project_context(project_id)` → read-only compose of existing fns → one payload. No state change.

No new background process. No new client fetch (reuses the existing agents poll).

---

## Testing
- **heartbeat:** integration — `setAgentStatus` sets both columns; a second call overwrites; the MCP `heartbeat` handler updates the right agent. `/api/agents` returns `current_status`/`current_status_at`.
- **get_project_context:** integration — returns the project, only `open` milestones (with progress), only `in_progress` tasks, only active (unresolved) blockers for that project, and recent activity capped at the limit; unknown `project_id` yields the chosen error shape.
- **migration 016:** the two columns exist on `agents` after migrations (extend the existing migration/persistence test).
- **LiveRosterCard:** shows `current_status` when present; falls back to `current_task_title` when status is absent; (optional) shows status age.
- **No regression:** existing MCP tool tests, agent tests, and roster tests still pass.

---

## Risks / Notes
- **Stale status:** a status persists until the next heartbeat; an agent that sets "running tests" then goes idle would still show it. Mitigated by showing the freshness dot (last_seen_at) + the status age (`current_status_at`) in the roster — the user can see it's old. No auto-clear (YAGNI).
- **WS vs poll for status updates:** the roster already polls every 3s, so live-ish updates are free. Avoid inventing a new WS event unless a suitable one already exists — keep the surface minimal (plan decides).
- **`get_project_context` is read-only** — must not mutate or broadcast.
- **Adoption:** `heartbeat` only helps if agents call it; the roster degrades gracefully to the task title when they don't. This is the intended fallback, not a gap.
- **`listAgents` column surfacing:** confirm `listAgents`/the agents route returns the new columns (SELECT * picks them up automatically); if the route maps explicit fields, add them.

---

## Out-of-scope follow-ups
- Auto-expiry of stale status (show-age is sufficient for now).
- Agent self-reporting richer telemetry (progress, current file) — not needed.
