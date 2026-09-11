# FleetView — 4-preset switcher sketch

**Date:** 2026-05-12
**Task:** vibe-dash 57558c9c
**Prereq for:** 7ef6593a (consolidation)
**Status:** Approved (auto-mode); revisit if user interviews (60da50b5) invalidate the model.

## Why

We have 10 top-level dashboard views. Most of them answer the same root question — "what state is my work in?" — with different framings. Collapsing them into a single **FleetView** with 4 selectable presets, plus two specialized top-level views (**TaskBoard**, **Feed**), preserves the answers without paying the navigation tax of a 10-button switcher.

## The new top-level surface

Three top-level views, switched by `activeView`:

| `activeView` | Component | Purpose | Keybind |
|---|---|---|---|
| `fleet` | `<FleetView />` | Status, signals, planning — preset-driven | `g f` |
| `board` | `<TaskBoard />` | Kanban for moving today's work | `g b` |
| `feed` | `<ActivityStreamView />` | Chronological raw stream — debug, audit | `g v` |

FleetView reads `fleetPreset` and renders one of:

| `fleetPreset` | Preset | Sub-keybind | Subsumes |
|---|---|---|---|
| `overview` | **Overview** | `1` | DashboardView, ExecutiveView |
| `hotspots` | **Hot spots** | `2` | HotSpotsView, OrchestrationView |
| `agents` | **Agents** | `3` | AgentDashboard, WorktreeView |
| `timeline` | **Timeline** | `4` | TimelineView (kept, re-skinned) |

Deleted entirely: `TaskListView` (Kanban covers it; users who want a list use search).

## View-to-preset routing table (mechanical)

This is the mapping the consolidation task (7ef6593a) executes:

| Old `activeView` value | New target |
|---|---|
| `dashboard` | `fleet` + preset `overview` |
| `executive` | `fleet` + preset `overview` |
| `orchestration` | `fleet` + preset `hotspots` |
| `hotspots` | `fleet` + preset `hotspots` |
| `agents` | `fleet` + preset `agents` |
| `worktrees` | `fleet` + preset `agents` |
| `timeline` | `fleet` + preset `timeline` |
| `board` | `board` (unchanged) |
| `activity` | `feed` |
| `list` | `board` (TaskListView deleted; users land on Kanban) |

`StatPill` clicks in TopBar (currently dispatching `SET_ACTIVE_VIEW`) re-map to:

| StatPill | Old dispatch | New dispatch |
|---|---|---|
| Tasks total | `dashboard` | `fleet` + `overview` |
| In-progress | `board` | `board` |
| Blockers | `hotspots` | `fleet` + `hotspots` |
| Cost | `dashboard` | `fleet` + `overview` |
| Agents | `agents` | `fleet` + `agents` |

Keyboard shortcuts in App.tsx — replace `gd / ga / gl / gt / gh` with `gf / gb / gv` + `1/2/3/4` inside fleet.

## ASCII wireframe

```
┌─ TopBar ──────────────────────────────────────────────────────────────────────┐
│ vibe-dash  ⌘K Search [scope: tasks ▾]   [⏰ alerts]   [🌗 theme]   [Scott ▾]  │
│                                                                                │
│  Tasks  In-prog  Blockers  Cost(7d)  Agents                                   │
│   42      8        2*       $4.17     5                                       │
├─ ViewToggle ──────────────────────────────────────────────────────────────────┤
│         [ Fleet ]   [ Board ]   [ Feed ]                                      │
└────────────────────────────────────────────────────────────────────────────────┘
┌─ FleetView (when activeView=fleet) ───────────────────────────────────────────┐
│  PresetSwitcher                                                               │
│  ┌───────────┬───────────┬───────────┬───────────┐                            │
│  │ Overview  │ Hot spots │  Agents   │ Timeline  │   (1) (2) (3) (4)         │
│  │ ●         │           │           │           │                            │
│  └───────────┴───────────┴───────────┴───────────┘                            │
│                                                                                │
│  ┌─── Overview preset (example) ────────────────────────────────────────┐    │
│  │  KPI cards row  │  Milestone progress bars  │  Cost timeseries chart │    │
│  │  Project health cards (from ExecutiveView)  │  Blockers list         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────────┘
┌─ AgentFeed (right rail, always visible) ──────────────────────────────────────┐
│  ● agent-a │ in_progress task X │ 2m ago                                      │
│  ● agent-b │ blocker reported   │ 5m ago                                      │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Preset contents — what each preset shows

### Overview (`fleetPreset = "overview"`)

Composes `DashboardView`'s body + `ExecutiveView`'s project health cards. Top-left: KPI cards. Top-right: cost timeseries. Below: milestone progress bars, project health cards, blockers/overdue summary, report generator. No agent detail, no timeline.

### Hot spots (`fleetPreset = "hotspots"`)

Wraps `HotSpotsView`'s detector match list. Adds the health-score gauge and at-risk milestone block from `OrchestrationView`. Removes the compute heatmap and token-consumption chart (those move to Overview's cost row, or are dropped if redundant with the cost timeseries).

### Agents (`fleetPreset = "agents"`)

Composes `AgentDashboard`'s agent cards + comparison panel + `WorktreeView`'s worktree status table. Clicking an agent card opens the existing agent detail drawer.

### Timeline (`fleetPreset = "timeline"`)

Thin wrapper around `TimelineView`. No changes to the gantt logic itself; only the chrome (preset switcher, no top-level nav button) changes.

## Component file layout

```
src/components/fleet/
  FleetView.tsx              # container: reads fleetPreset, renders preset
  PresetSwitcher.tsx         # segmented control
  presets/
    Overview.tsx
    HotSpots.tsx
    Agents.tsx
    TimelinePreset.tsx       # named to avoid clashing with existing TimelineView
```

Existing leaf components (KPI cards, milestone bars, agent cards, gantt) are *not* rewritten — they get imported into the preset components. The preset components are thin compositors.

## Files to delete after migration verifies

- `src/components/DashboardView.tsx`
- `src/components/ExecutiveView.tsx`
- `src/components/orchestration/OrchestrationView.tsx`
- `src/components/HotSpotsView.tsx` (logic moved to `presets/HotSpots.tsx`)
- `src/components/AgentDashboard.tsx` (logic moved to `presets/Agents.tsx`) — *except* the `agent-dashboard/` subfolder of detail components, which `presets/Agents.tsx` re-imports.
- `src/components/WorktreeView.tsx`
- `src/components/TaskListView.tsx`

`ActivityStreamView.tsx` is kept (it *is* the `feed` view), as are `TaskBoard.tsx` and `TimelineView.tsx`.

## State changes

```ts
// src/state/types.ts
type ActiveView = "fleet" | "board" | "feed";
type FleetPreset = "overview" | "hotspots" | "agents" | "timeline";

interface NavigationState {
  activeView: ActiveView;
  fleetPreset: FleetPreset;
  // ...rest unchanged
}
```

New action: `SET_FLEET_PRESET` with payload `FleetPreset`. Reducer arm in `src/store.tsx`.

## Risks & mitigations

- **Existing tests reference old `activeView` values.** Mitigation: grep for `"dashboard" | "executive" | …` and update in lockstep with the type change.
- **URL deep-links may encode `activeView`.** Mitigation: grep for `searchParams.set("view"` and `searchParams.get("view"`; if found, accept both old and new values during a 1-version migration window.
- **`StatPill` clicks lose direct mapping.** Mitigation: each pill dispatches *two* actions (`SET_ACTIVE_VIEW` then `SET_FLEET_PRESET`) — small ergonomic regression accepted for the simpler model.

## Approval

In auto-mode, the plan's recommended 4-preset model is approved as the working assumption. The user interviews from task 60da50b5 are the disconfirmation mechanism — if they invalidate the model, the consolidation can be revised, not reverted (preset names are cheap to change; the underlying composition is stable).
