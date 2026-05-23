# Vibe Dash — View Purposes

Vibe Dash has three top-level views. Within **Fleet**, four presets swap which surfaces are visible. Keep purposes distinct when adding panels.

## Top-level views

| View key | Nav label | Purpose |
|---|---|---|
| `fleet` | Fleet | Cross-project command center. Surfaces swap via [fleet presets](#fleet-presets). |
| `board` | Board | Kanban board (`TaskBoard`) for moving tasks across status columns (planned → in_progress → blocked → done). |
| `feed` | Feed | Chronological stream of all agent activity (`ActivityStreamView`) grouped by day for audit and observability. |

State lives in `src/state/types.ts` as `ActiveView = "fleet" | "board" | "feed"`. Routing happens in `src/App.tsx`.

## Fleet presets

`FleetPreset = "overview" | "hotspots" | "agents" | "timeline"`. Composition lives in `src/components/fleet/FleetView.tsx`.

| Preset | Composed of | Purpose |
|---|---|---|
| `overview` | `DashboardView` + `ExecutiveView` | At-a-glance project health, milestone progress, cost trends, sprint burndown — the default landing surface. |
| `hotspots` | `HotSpotsView` + `OrchestrationView` | Where attention is needed: active blockers, ad-hoc detector signals (commits, scope changes, activity bursts), agent compute and token spend. |
| `agents` | `AgentDashboard` + `WorktreeView` | Per-agent health (sessions, current task, recent activity, model) and git worktree management linked to tasks. |
| `timeline` | `TimelineView` | Gantt-style visualization of task durations, sprint boundaries, and inter-task dependencies. |

## When adding a new surface

1. Pick the preset that matches its purpose; don't add a 5th preset unless the existing four genuinely can't host it.
2. If it's a top-level concern that doesn't fit Fleet/Board/Feed, propose a new `ActiveView` in the design — but the bias is strongly toward extending Fleet presets.
3. Update this file when adding presets or top-level views.
