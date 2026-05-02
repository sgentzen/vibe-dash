# Vibe Dash — Design Critique Remediation Plan

> **Status (2026-05-02):** Plan approved. Backed by **99 tasks** across **10 milestones** in
> [Vibe Dash](https://github.com/sgentzen/vibe-dash) (project `f5e0c4e8-45d4-4fec-8177-46509c5f184a`),
> all tagged `design-critique`. Use `mcp__vibe-dash__list_tasks` filtered by tag to track execution.
>
> Source: design critique of Orchestration / Agents / Dashboard / Timeline / Executive views,
> 2026-05-01. See sibling [PROGRAM-REVIEW-2026-04.md](../PROGRAM-REVIEW-2026-04.md) for parent strategy.


## Context

A design critique of the Vibe Dash UI surfaced ~30 issues across IA, hierarchy, color semantics, accessibility, and per-view polish. This plan turns them into a structured backlog: **10 milestones** grouping the problem domains, then **detailed task breakdowns** under each — every task grounded in actual files and functions in this codebase.

The plan is approval-ready: each task names file paths, existing functions/types to reuse, and a concrete change. No code is written here. After approval, milestones + tasks will be created in vibe-dash via `create_milestone` / `create_task` MCP tools (project_id confirmed via `list_projects` first).

### Architecture facts that shaped this plan

- **CSS tokens** live in `src/App.css`: only `--accent-{red,green,blue,yellow,purple,cyan}` exist — no `--status-*` semantic layer.
- **Status color map** is in `src/constants/colors.ts` (used by TaskCard, AgentFeed, ProjectList).
- **Right rail** (`AgentFeed`) is a sibling `<aside>` in `App.tsx` line 194 — global, no per-view prop.
- **Top bar** in `src/components/TopBar.tsx` — the two "mystery" buttons are a theme toggle and accent-color picker (`<input type="color">`); they read as mystery because of weak iconography, not because they lack purpose.
- **Search** dispatches `SET_SEARCH_QUERY` to the store; consumed by views for filtering. No scope/routing.
- **Milestone health** (`on_track | at_risk | behind`) already exists on `ExecutiveSummary.milestone_health[]` from the server — but is *only* surfaced in `ExecutiveView.tsx`. Other views compute progress % only.
- **Timeline** at `src/components/TimelineView.tsx` already renders a today line. Color logic prioritizes `anomaly` (blocked/overdue/stale) → status (done/in_progress/etc). No cancelled state.
- **Token Consumption trend** in `src/components/orchestration/TokenConsumptionChart.tsx` is `(last − firstNonZero) / firstNonZero` — endpoint-only delta, blind to mid-period shape. This is why "+65%" coexists with a visibly dipping line.
- **Agents table** has `UNIQUE(name)` (case-sensitive) — "Claude" and "claude" are distinct rows. No normalization in `registerAgent` (`server/db/agents.ts`).
- **WebSocket events** are listed in `server/types.ts` lines 237–262; `broadcast()` wrapper in `server/routes.ts` line 109 handles fan-out + webhooks.

---

## Milestones

| # | Milestone | Severity | Sequencing |
|---|---|---|---|
| M1 | Information Architecture & Redundancy | 🔴 | First — defines view boundaries |
| M2 | Semantic Color & Status Token Layer | 🔴 | Foundation for M5, M6, M8 |
| M3 | Top Navigation & Global Chrome | 🔴 | Independent, quick wins |
| M4 | Agents View & Agent Identity | 🟡 | Depends on data normalization |
| M5 | Timeline View Polish | 🟡 | Depends on M2 tokens |
| M6 | Executive View & Health Surfacing | 🟡 | Depends on M2 tokens |
| M7 | Visual Hierarchy & Typography | 🟡 | Cross-cutting |
| M8 | Accessibility (WCAG 2.1 AA) | 🟡 | Parallel with M2/M7 |
| M9 | Empty States & Density | 🟢 | Polish |
| M10 | Metric Clarity & Headline Honesty | 🟢 | Polish |

---

## M1 — Information Architecture & Redundancy

**Problem:** Active Agents shown in 3 places (top stat, right rail, Agents view). Milestone Progress duplicated across Overview and Dashboard. Right rail occupies ~15% of every view including Timeline/Executive where it adds little.

### M1-T1 Define canonical purpose for each top-level view
- **Deliverable:** `docs/views.md` with 1-sentence purpose per view (Orchestration, Board, Agents, List, Dashboard, Timeline, Activity, Worktrees, Executive).
- **Source of truth:** `src/state/types.ts` `ActiveView` union.
- **No code changes.** Outputs decisions for M1-T2/T5.

### M1-T2 Audit duplication: Orchestration vs Dashboard
- Compare `src/components/orchestration/OrchestrationView.tsx` (default view) and `src/components/DashboardView.tsx`.
- Identify overlapping blocks (Milestone Progress, Active Blockers card, agent breakdown, recent events).
- **Output:** decision matrix in `docs/views.md` of what each view keeps. Recommended split: Orchestration = portfolio + live agent activity; Dashboard = single-project deep dive (KPI tiles + milestone burndown + heatmap).

### M1-T3 Add right-rail collapse state to global store
- **Files:** `src/store.tsx`, `src/state/types.ts`.
- **Add:** `rightRailCollapsed: boolean` to `AppState`; action `TOGGLE_RIGHT_RAIL`; persist to `localStorage` via existing pattern (theme already does this — mirror its approach).
- **Wire:** `App.tsx` line 194 wraps `<AgentFeed />` in conditional render or applies `data-collapsed` attribute. Add a chevron toggle on the rail's left edge.

### M1-T4 Default-collapse right rail on Timeline & Executive
- **File:** `App.tsx` — when `activeView === "timeline" || activeView === "executive"`, default `rightRailCollapsed = true` on view switch (only on first switch; user override sticks).
- Implementation: a small `useEffect` watching `activeView` that conditionally dispatches.

### M1-T5 Remove duplicate Milestone Progress from whichever view loses it
- Per M1-T2 outcome. Delete the redundant block. Likely: keep in Dashboard (project-scoped), remove the long list version from `OrchestrationView.tsx`. Replace on Orchestration with a compact "Top 3 At-Risk Milestones" tile (uses M6 health computation).

### M1-T6 Persistent project-context chip on every view header
- **New component:** `src/components/ProjectContextChip.tsx` — shows currently selected project name + status dot, clickable to clear/switch.
- **Render in:** view header of each view component (TaskBoard, AgentDashboard, DashboardView, TimelineView, ActivityStreamView, WorktreeView, ExecutiveView). Skip on List view if it's already global.
- **Data source:** `state.selectedProjectId` + `state.projects.find(...)`.

---

## M2 — Semantic Color & Status Token Layer

**Problem:** Everything routes through `--accent-{red,green,blue,yellow,purple,cyan}`. Purple has no semantic meaning but appears as Timeline bars, agent avatars, tag pills. Green means both "good" and "done". Status pills derive color via inline references with no central naming.

### M2-T1 Define semantic token layer in `src/App.css`
- Add to `:root`:
  ```
  --status-success: var(--accent-green);
  --status-warning: var(--accent-yellow);
  --status-danger:  var(--accent-red);
  --status-info:    var(--accent-blue);
  --status-neutral: var(--text-muted);
  ```
- And glow variants (already exist for green/red): add `--shadow-glow-yellow`, `--shadow-glow-blue`.
- Document in a new `:root` comment block: "Use `--status-*` for state, `--accent-*` only for branded UI."

### M2-T2 Build the status → token map
- **New file:** `src/constants/statusTokens.ts`.
- Export typed maps:
  ```ts
  export const TASK_STATUS_TOKEN: Record<TaskStatus, StatusToken> = {
    planned: "neutral", in_progress: "success", blocked: "danger", done: "info"
  };
  export const MILESTONE_HEALTH_TOKEN: Record<MilestoneHealth, StatusToken> = {
    on_track: "success", at_risk: "warning", behind: "danger"
  };
  export const AGENT_HEALTH_TOKEN: Record<AgentHealth, StatusToken> = {
    active: "success", idle: "warning", offline: "neutral"
  };
  ```
- Helper: `tokenToColor(t: StatusToken): string` returns `var(--status-${t})`.

### M2-T3 Refactor `src/constants/colors.ts` to consume the token map
- Replace the existing inline mappings with calls to `tokenToColor()`. Keep the public API (`statusColor()`, `agentHealthColor()`) so callers don't change.
- Tests: add `tests/status-tokens.test.ts` verifying every TaskStatus / MilestoneHealth / AgentHealth value has a token.

### M2-T4 Replace ad-hoc color references with tokens
- Targets:
  - `src/components/TaskCard.tsx` — currently `var(--accent-green)` etc, switch to `var(--status-success)` via `tokenToColor`.
  - `src/components/AgentFeed.tsx` — same.
  - `src/components/TimelineView.tsx` lines 44–75 — anomaly/status branches → tokens.
  - `src/components/ExecutiveView.tsx` — health pills.
- Audit via Grep: `--accent-(red|green|yellow|blue)` references. Each becomes a `--status-*` or stays accent if it's branding (logo, project highlight).

### M2-T5 Pair every status pill with an icon
- **New component:** `src/components/StatusPill.tsx`.
  ```tsx
  <StatusPill token="success" label="On Track" /> // renders ✓ + label
  ```
- Icons (text glyphs to avoid adding deps): `success: ✓`, `warning: ⚠`, `danger: ✗`, `info: ●`, `neutral: ○`.
- Replace inline pill JSX in:
  - `ExecutiveView.tsx` (`On Track`/`At Risk`/`Behind` pills lines 75–96)
  - `AgentDashboard.tsx` (`active`/`idle` pills)
  - `TimelineView.tsx` legend (lines 23–28)
  - `TaskCard.tsx` priority/due badges

### M2-T6 Document the system in `docs/design-system.md`
- Token list, when to use each, before/after examples, the icon pairing rule.

---

## M3 — Top Navigation & Global Chrome

**Problem:** The theme toggle and accent picker (TopBar.tsx) are visually indistinguishable from primary actions. Search has no scope. KPI stat tiles aren't clickable. Casing is inconsistent (`Dashboard` vs `Agent Dashboard` vs `AI AGENT ORCHESTRATION OVERVIEW`).

### M3-T1 Improve theme toggle + accent picker affordance
- **File:** `src/components/TopBar.tsx`.
- Wrap both controls in a single "Appearance" popover button (icon: 🎨 or palette glyph) so they don't compete with primary actions. The popover contains: theme toggle (Light/Dark/System) + accent picker.
- Alternatively (cheaper): keep inline but add `aria-label` + `title` tooltips and group with a subtle divider.

### M3-T2 Add scope selector + ⌘K hint to search
- **File:** `src/components/TopBar.tsx` lines 80–94.
- Wrap input in a flex container: `<select>` for scope (`Tasks | Projects | Agents | All`) + input + kbd hint.
- Add `searchScope: "tasks" | "projects" | "agents" | "all"` to `AppState`; default `"all"`.
- Consumers in views check `state.searchScope` before filtering.
- ⌘K: add a global keydown listener in `App.tsx` (or new `useKeyboardShortcuts` hook) that focuses the search input on `Cmd/Ctrl+K`.

### M3-T3 Make top stat tiles interactive
- **File:** `src/components/topbar/StatPill.tsx`.
- Add `onClick?: () => void`; hover state via existing CSS variables (`--bg-tertiary`).
- Wire in `TopBar.tsx`:
  - Projects → no-op (already shown in sidebar) or scrolls sidebar.
  - Active Agents → dispatch `SET_ACTIVE_VIEW: "agents"` + apply `searchScope: "agents"`.
  - Alerts → open `NotificationBell`'s panel.
  - Tasks → `SET_ACTIVE_VIEW: "list"`.
- Add focus ring (M8 will verify).

### M3-T4 Standardize page-title casing
- **Convention:** sentence case for page titles, uppercase tracked-out for section labels (already used in OrchestrationView for "AI AGENT ORCHESTRATION OVERVIEW").
- Audit: each view's H1/H2.
  - `DashboardView.tsx`: "Dashboard" → keep (sentence).
  - `AgentDashboard.tsx`: "Agent Dashboard" → keep (sentence).
  - `OrchestrationView.tsx`: section label "AI AGENT ORCHESTRATION OVERVIEW" → keep; promote a sentence-case title above it ("Orchestration").
- One PR-ready pass; add a `docs/design-system.md` section codifying the rule.

### M3-T5 Add unit tests for TopBar dispatch behavior
- **New file:** `tests/topbar.test.tsx` (with React Testing Library if already in deps; else direct hook tests).
- Verify: stat-tile click → correct action dispatched; ⌘K focuses search.

---

## M4 — Agents View & Agent Identity

**Problem:** Five rows in Active Agents look near-identical ("Claude" / "claude" / "Claude Code" / "Claude Sonnet 4.6" / "claude-sonnet-4-6"). All use a generic "C" avatar. Cards on the Agents view show "Sessions: 0 / Completed today: 8" — contradictory. Right rail duplicates the main content on this view.

### M4-T1 Decide normalization strategy
- **Investigation file:** `server/db/agents.ts` `registerAgent()` (lines 38–51).
- Current: `SELECT id FROM agents WHERE name = ?` — case-sensitive, exact-match.
- **Options:**
  - **A. Normalize on ingest:** lowercase + trim + collapse `_-` to space; store `name_normalized` column; UNIQUE on that. Display original `name`.
  - **B. Surface duplicates in UI:** add a "Possible duplicates" group on the Agents view; let the user merge.
- **Recommendation:** A. It's a data-quality bug, and the UI shouldn't paper over it.
- **Output:** ADR in `docs/adr/agents-name-normalization.md`.

### M4-T2 Implement chosen normalization
- **Schema migration** in `server/db/schema.ts`: add `name_normalized TEXT NOT NULL`, backfill from existing rows (`UPDATE agents SET name_normalized = lower(trim(replace(replace(name, '_', ' '), '-', ' ')))`), then `CREATE UNIQUE INDEX idx_agents_name_norm ON agents(name_normalized)` after de-duping.
- **De-dup step:** for each normalized collision, keep oldest `registered_at`; reassign FKs from duplicates (activity_log.agent_id, file_locks, etc) to the survivor; delete duplicates. Wrap in transaction.
- **Update `registerAgent`:** compute normalized name, query by it, update or insert.
- **Tests:** extend `tests/db.test.ts` — register "Claude", then "claude", assert one row.

### M4-T3 Replace generic "C" avatar with model-family glyph
- **Files:** `src/utils/agentColors.ts`, `src/components/agent-dashboard/AgentCard.tsx`, `src/components/AgentFeed.tsx` lines 107–121.
- Add helper `agentGlyph(agent: Agent): string` that maps `model` field:
  - `*opus*` → `◆`, `*sonnet*` → `◇`, `*haiku*` → `○`, fallback: first letter.
- Color stays `agentColor(name)` from existing util.
- Apply in both AgentCard and the compact rail row.

### M4-T4 Reconcile "Sessions: 0 / Completed today: 8"
- **Investigate:** AgentCard renders `agent.completed_today` and `agent.session_count`. Find data source — likely `getAgentStats()` route. The mismatch suggests sessions are tracked by `session_started`/`session_ended` events but completion uses `task_completed`.
- **Fix:** either (a) backfill sessions for legacy completions or (b) drop the `Sessions: 0` chip when sessions are zero AND completions exist (i.e., legacy data). Recommend (b) initially, then (a) once we trust session tracking.
- **File:** `src/components/agent-dashboard/AgentCard.tsx` — conditional render.

### M4-T5 Promote "Working on: <task>" to a primary slot
- **File:** `src/components/agent-dashboard/AgentCard.tsx`.
- Currently buried in body text. Move to a dedicated sub-header line below name+role, with task icon prefix and clickable link to the task detail (`SELECT_TASK` action / nav).

### M4-T6 Auto-collapse right rail on Agents view
- Per M1-T4 pattern, add `agents` to the auto-collapse list.

### M4-T7 Reduce AgentCard padding
- **File:** `src/components/agent-dashboard/AgentCard.tsx`.
- Audit current padding (~24-32px). Halve to 12-16px. Verify nothing wraps badly. Capture before/after screenshots in PR.

### M4-T8 Test agent normalization end-to-end
- **New test file:** `tests/agent-normalization.test.ts`.
- Cases: case-folded duplicates merge; `claude_code` and `Claude Code` collapse; FK reassignments preserve activity counts.

---

## M5 — Timeline View Polish

**Problem:** Cancelled items render as solid purple bars identical to active. Bar widths don't visibly differ. Truncated labels lack tooltips. **Note:** today indicator already exists (lines 218–282 of TimelineView.tsx) — original M5-T2 dropped.

### M5-T1 Honor the status legend with distinct bar styles
- **File:** `src/components/TimelineView.tsx` lines 44–75 (`barStyle()` function).
- Extend with explicit cancelled handling. Tasks with `status === "cancelled"` (add to TaskStatus type if missing): strikethrough text + `--status-neutral` background + `opacity: 0.4`.
- Failed (anomaly === "blocked"): switch from solid red to red with diagonal-stripe pattern (CSS `repeating-linear-gradient`).
- Planned: outline-only style (`background: transparent; border: 1px dashed var(--status-neutral)`).
- Running: keep solid green, add subtle `box-shadow: var(--shadow-glow-green)`.
- Completed: keep current accent-blue at 0.35 opacity.
- Update LEGEND constant lines 23–28 and the legend render (lines 465–472) to render with `<StatusPill>` from M2-T5.

### M5-T2 ~~Today indicator~~ — Already implemented; drop.

### M5-T3 Verify bar duration accuracy
- **Investigate:** in `TimelineView.tsx`, find `taskBarWidth` calculation. If all bars look like slivers, either (a) the timeline window is too wide for short tasks, or (b) widths are clamped to a minimum that overrides reality.
- Add a minimum width of `8px` only for visual hit-target; otherwise compute strictly from `start_date → due_date`.
- Add a "fit to data" toolbar button that sets the window to `min(start) → max(due) + 7d`.

### M5-T4 Add hover tooltips to truncated bar labels
- **File:** `src/components/TimelineView.tsx` lines 351–387 (bar render).
- Add `title={task.title}` attribute and `aria-label`. Future: replace with a portal-based tooltip component for richer content (dates, owner, status).

### M5-T5 Group cancelled items into a collapsible "Cancelled (N)" section
- **File:** `src/components/TimelineView.tsx`.
- Partition tasks by status before rendering: `[active, ...other], cancelled`.
- Render cancelled inside a collapsed-by-default `<details>` group.
- Toolbar adds count: "12 cancelled (hidden)".

### M5-T6 Add toolbar control: "Hide cancelled"
- Mirror existing "Hide Completed" checkbox (line 452). New checkbox in the same toolbar component.

---

## M6 — Executive View & Health Surfacing

**Problem:** Every milestone shows "On Track" green, even at 0% with a near-due date. The view is one flat list — no grouping by health. Milestone health type *exists* on the API (`on_track | at_risk | behind`) but the server may be returning all `on_track` because the computation is naive.

### M6-T1 Audit and fix milestone-health computation
- **Files:** `server/db/sprints.ts`, server route returning `getExecutiveSummary`.
- Current: confirm the actual health calculation. Per exploration, likely just progress %.
- **New formula** (in a dedicated helper `computeMilestoneHealth(milestone)`):
  ```
  let progress = completed_tasks / total_tasks;  // 0..1
  let elapsed  = (now - start_date) / (due_date - start_date);  // 0..1
  let delta    = progress - elapsed;
  if (now > due_date && progress < 1) return "behind";
  if (delta < -0.15) return "at_risk";
  if (delta < -0.30) return "behind";
  return "on_track";
  ```
- **Edge cases:** no start_date → use `created_at`; no due_date → "on_track" + flag undated separately.
- **Tests:** `tests/milestone-health.test.ts` covering the four quadrants.

### M6-T2 Group Executive milestones by health
- **File:** `src/components/ExecutiveView.tsx` lines 75–96.
- Partition `summary.milestone_health` array by `health` field, render as three sections: "Behind (N)", "At Risk (N)", "On Track (N)" — each collapsible, "Behind" expanded by default.

### M6-T3 Move health pill to fixed right column
- **File:** `src/components/ExecutiveView.tsx`.
- Convert milestone row from inline to `display: grid; grid-template-columns: 1fr auto 200px;` (title | progress | pill). Pill always right-aligned.
- Use `<StatusPill>` from M2-T5.

### M6-T4 Top-of-page summary row with click-to-filter
- Three big tiles above the milestone list: `N Behind`, `N At Risk`, `N On Track`. Click a tile → collapse the other two sections, scroll to the corresponding section.

### M6-T5 Add at-risk-only export
- **File:** `src/components/ExecutiveView.tsx` `handleExport()` (lines 129–138).
- Add a second button "Export At-Risk JSON" filtering to `health !== "on_track"` before serializing. Filename: `exec-summary-at-risk-{project_id}.json`.

### M6-T6 Surface milestone health in Orchestration view
- The "Top 3 At-Risk Milestones" tile from M1-T5 consumes the same API. Reuses `getExecutiveSummary()` or pulls from `milestone_health` cached in store.

---

## M7 — Visual Hierarchy & Typography

**Problem:** Most text reads as one weight. KPI tiles on Dashboard are huge despite three of them being zero. Truncation happens without `title` fallbacks. Spacing is ad-hoc.

### M7-T1 Define a type scale in `src/App.css`
- Add tokens:
  ```
  --type-display: 600 32px/1.2;
  --type-h1:      600 24px/1.3;
  --type-h2:      600 18px/1.4;
  --type-body:    400 14px/1.5;
  --type-caption: 400 12px/1.4;
  --type-micro:   500 11px/1.3 letter-spacing:0.05em uppercase;
  ```
- Document in `docs/design-system.md`.

### M7-T2 Apply weight differentiation
- Audit pass: page titles → `--type-h1`; section labels → `--type-micro`; body → `--type-body`; metadata ("1 in progress · 203/230 done") → `--type-caption` with `color: var(--text-muted)`.
- Targets: `ProjectList.tsx`, `TopBar.tsx`, every view header, `AgentCard.tsx`.

### M7-T3 Audit truncation; add `title` attributes
- Grep for `slice(0,` and `text-overflow: ellipsis` across `src/`. Each occurrence either gains a `title={fullText}` attribute or moves to a portal-based tooltip wrapper.
- Notable hot spots: `AgentComputeHeatmap.tsx` line 123 (agent name truncate), Timeline bar labels (M5-T4 covers).

### M7-T4 Standardize spacing
- Add CSS vars to `App.css`: `--space-1: 4px` … `--space-8: 48px` (4/8/12/16/24/32/48/64 scale).
- Replace hardcoded `padding: 16px` / `gap: 12px` etc with vars in: `App.tsx`, view components, cards.

### M7-T5 Right-size Dashboard KPI tiles
- **File:** `src/components/DashboardView.tsx`.
- Currently 4 huge tiles. Reduce to a single horizontal row of compact tiles (~80px tall) when ≥2 values are zero. When all populated, allow expanded form.
- Add a "trend sparkline" miniature inside each — uses last-7-days from existing `getCostTimeseries` / `getActivityHeatmap`.

---

## M8 — Accessibility (WCAG 2.1 AA)

### M8-T1 Baseline audit
- Add `axe-core` (or `@axe-core/react`) as a dev dep. Run on each view; record violations in `docs/a11y-baseline.md`.
- Also run Lighthouse a11y on each route.

### M8-T2 Body & metadata contrast
- Targets (per critique): `--text-secondary`, `--text-muted` against `--bg-primary`, `--bg-secondary`. Compute current ratios; bump until body ≥ 4.5:1, micro ≥ 7:1.
- Update tokens in `App.css`, verify across dark + light themes.

### M8-T3 Status icons (covered by M2-T5)
- Track here as the a11y verification gate: every status color must also have an icon.

### M8-T4 Heatmap legend
- **File:** `src/components/orchestration/AgentComputeHeatmap.tsx`.
- Below or beside the heatmap, render a 5-step gradient bar with min/max labels (`0` → `max count`). Use the same opacity ramp as the cells.
- Cell `aria-label` includes count: `aria-label="claude — hour 17 — 12 events"`.

### M8-T5 Touch targets & focus rings
- Audit interactive elements; ensure ≥32×32px hit area.
- Add a global focus-visible style in `App.css`: `*:focus-visible { outline: 2px solid var(--status-info); outline-offset: 2px; }`.

### M8-T6 Keyboard navigation
- Verify Tab order through TopBar → sidebar → main view → right rail.
- Verify dialogs (Settings, NotificationBell panel, Onboarding) trap focus and ESC closes.

---

## M9 — Empty States & Density

### M9-T1 Collapse empty "No active blockers" card
- **File:** `src/components/orchestration/OrchestrationView.tsx` (or wherever Active Blockers card lives).
- When `blockers.length === 0`: render a single-line `<div role="status">✓ No active blockers</div>` (~32px tall) instead of the current ~200px card.

### M9-T2 Reusable `<EmptyState />` component
- **New:** `src/components/EmptyState.tsx`.
- Props: `compact?: boolean`, `icon?`, `message`, `action?`.
- Compact form: single line. Full form: centered icon + message + optional CTA.

### M9-T3 Apply across views
- Audit cards on Orchestration & Dashboard for empty states. Replace each with `<EmptyState compact />`.

---

## M10 — Metric Clarity & Headline Honesty

### M10-T1 Fix Token Consumption trend
- **File:** `src/components/orchestration/TokenConsumptionChart.tsx` lines 16–29, 45–58.
- Current: `(last - firstNonZero) / firstNonZero` — compares two endpoints, ignores middle.
- Replace with **one** of:
  - **Rolling 7d vs prior 7d:** `(avg(days[-7..]) - avg(days[-14..-7])) / avg(days[-14..-7])`.
  - **Linear regression slope** (the comment in code says "linear regression" but the code is actually endpoint delta — fix to actual regression).
- Headline label: "Trend (7d vs prior 7d): +X%" — explicit baseline.
- Annotate the chart with a dashed line showing the 7d rolling average overlay.

### M10-T2 Audit every headline metric for baseline clarity
- Targets: Token Consumption, Project Health Score gauge ("88" — out of what?), Daily 1.2M, KPI tiles.
- Each gets either a tooltip explaining the calculation or a baseline label inline.

### M10-T3 Add tooltips to every percentage / delta
- Pattern: a small ⓘ icon next to the number that opens a tooltip: "Calculated as: (this week − last week) / last week. Window: rolling 7d."

---

## Critical Files (one-stop list)

| Concern | File |
|---|---|
| Theme tokens | `src/App.css` |
| Status color map | `src/constants/colors.ts` (refactor) + `src/constants/statusTokens.ts` (new) |
| State shape | `src/store.tsx`, `src/state/types.ts` |
| Top bar | `src/components/TopBar.tsx`, `src/components/topbar/{StatPill,ViewToggle,NotificationBell,AddProjectControl}.tsx` |
| Right rail | `src/components/AgentFeed.tsx` (mounted in `App.tsx` line 194) |
| Agent identity | `server/db/agents.ts`, `src/utils/agentColors.ts`, `src/components/agent-dashboard/AgentCard.tsx` |
| Timeline | `src/components/TimelineView.tsx` |
| Executive | `src/components/ExecutiveView.tsx` + server health route |
| Heatmap | `src/components/orchestration/AgentComputeHeatmap.tsx` |
| Token chart | `src/components/orchestration/TokenConsumptionChart.tsx` |
| Milestone health | `server/db/sprints.ts` (new helper) |

---

## Existing Patterns to Reuse

- CSS variables for theming — extend with a `--status-*` layer; do not introduce CSS-in-JS or a CSS module system.
- `useApi()`, `useWebSocket()`, `usePolling()` — sufficient; no new data hooks needed.
- `broadcast()` + `fireWebhooks()` after every mutation — preserve when adding milestone-health route.
- `createTestDb()` from `tests/setup.ts` — use for all server tests (M4-T2, M4-T8, M6-T1).
- Existing CSS variable theming pattern (theme via `data-theme` on `<html>`) — mirror for any new toggles (right-rail collapse, search scope).
- `localStorage` persistence pattern from theme — use for `rightRailCollapsed`, `searchScope`.

---

## Execution Approach

1. Confirm Vibe Dash `project_id` via `list_projects` MCP call.
2. Create the 10 milestones via `create_milestone` (use the table at the top for names + descriptions).
3. Create ~55 tasks via `create_task`, each tagged with `milestone_id` and a priority derived from the milestone severity.
4. Tag tasks with `design-critique` for filtering.
5. The user can drill deeper on specific milestones; M2 (color tokens) and M4 (agent normalization) are most likely to spawn sub-tasks per consumer file.

---

## Verification

This plan is verified by:
- 1:1 mapping of every priority recommendation in the original critique to a milestone (M1–M10 cover the 5 priority recommendations + 5 additional concern areas raised).
- Every task names a real file (verified during exploration phase).
- Every task either reuses an existing pattern (`StatusPill` consumes `statusTokens`, ProjectContextChip uses `state.selectedProjectId`) or proposes a new module with its expected location.
- Discoveries from exploration corrected the plan: dropped M5-T2 (today line exists), softened M3-T1 (buttons aren't mystery, they're under-affordanced), surfaced existing `milestone_health` API as the basis for M6.

After tasks are created, run `list_tasks --tag design-critique` to confirm coverage. No code is verified by this plan — per-task verification is deferred to each task's execution session.
