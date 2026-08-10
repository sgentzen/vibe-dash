# Vibe Dash — View Purposes

Vibe Dash has three top-level views. Within **Fleet**, two presets swap which
surface is visible. Keep purposes distinct when adding panels.

## Top-level views

| View key | Nav label | Purpose |
|---|---|---|
| `fleet` | Fleet | Cross-project command center. Surfaces swap via [fleet presets](#fleet-presets). |
| `board` | Board | Kanban board (`TaskBoard`) for moving tasks across status columns (planned → in_progress → blocked → done). |
| `feed` | Feed | Chronological stream of all agent activity (`ActivityStreamView`) grouped by day for audit and observability. |

State lives in `src/state/types.ts` as `ActiveView = "fleet" | "board" | "feed"`.
Routing happens in `src/App.tsx`.

## Fleet presets

`FleetPreset = "overview" | "agents"`. Composition lives in
`src/components/fleet/FleetView.tsx`, which renders exactly one component per
preset.

| Preset | Renders | Purpose |
|---|---|---|
| `overview` | `DashboardView` | At-a-glance project health, milestone progress and cost trends — the default landing surface. |
| `agents` | `AgentDashboard` | Per-agent health: sessions, current task, recent activity and model. |

## When adding a new surface

1. Pick the preset that matches its purpose; don't add a third preset unless
   neither existing one can host it.
2. If it's a top-level concern that doesn't fit Fleet/Board/Feed, propose a new
   `ActiveView` in the design — but the bias is strongly toward extending Fleet
   presets.
3. Update this file when adding presets or top-level views.

## Planned change

The 2026-06-24 refocus decision replaces this three-view structure with two
destinations — a Board front door and a back-room Insights page — retiring the
Fleet cluster. That work has not started beyond the dead-component deletion in
PR #125, so the table above describes the product as it is today, not as it is
intended to end up. Revisit this file when the refocus lands.
