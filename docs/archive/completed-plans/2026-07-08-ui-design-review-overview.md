# UI Design Review — Task Set & Plan Index

**Source:** Design Critique: Vibe Dash (2026-07-08). Every finding below was verified against the current code before planning.

**Scope decisions (confirmed with maintainer):**
- KPI-card sparklines → **dropped** (not backed by real per-metric history).
- Milestone progress chart → **true time axis + milestone selector**.
- Deliverable → these plan docs, then matching tracked tasks in the Vibe Dash project.

Each batch below is an **independent, separately-shippable plan**. Recommended order follows the review's priority ranking (responsive is a functional bug, not polish).

---

## The task set

| # | Batch | Severity | Plan | Tasks |
|---|-------|----------|------|-------|
| 1 | Responsive layout pass | 🔴 Critical | [`2026-07-08-responsive-layout-pass.md`](2026-07-08-responsive-layout-pass.md) | Header shrink/wrap; three-column grid breakpoints → off-canvas drawers |
| 2 | Honest dashboard charts | 🟡 Moderate | [`2026-07-08-honest-dashboard-charts.md`](2026-07-08-honest-dashboard-charts.md) | Drop KPI sparklines; milestone chart true time axis + selector |
| 3 | Accessibility batch | 🟡 Moderate | [`2026-07-08-accessibility-batch.md`](2026-07-08-accessibility-batch.md) | Landmarks (single `<main>`, `<nav>`, labelled `<aside>`); focusable scroll regions; ≥24px targets |
| 4 | UI micro-polish | 🟢 Minor | [`2026-07-08-ui-micro-polish.md`](2026-07-08-ui-micro-polish.md) | SVG icons; 11px type floor; non-red logo; ALERTS pill affordance; search focus-expand; pill consistency |

## Verified root causes (shared context for all plans)

- `src/App.css:121` — `.app { overflow: hidden }` with `grid-template-rows: auto 1fr auto`. No scrollbar ever appears at the app level, so anything past the viewport edge is unreachable.
- `src/App.css:128-132` — `.main-content { grid-template-columns: 200px 1fr 240px; overflow: hidden }`. **Zero media queries anywhere in the file.**
- `src/components/TopBar.tsx:69-80` — header is a single non-wrapping flex row (`gap: var(--space-5)`) carrying 11 controls; no `min-width: 0`, no `flex-wrap`. Min-content width ≈ 1135px → clips below that.
- `src/components/DashboardView.tsx:170-197` — all four `KpiCard`s receive the same `activityLast7` series (computed `:71-79`, `:121`).
- `src/components/dashboard/MilestoneCards.tsx:11-49` — chart renders `openMilestones[0]` only; bars are `flex: 1` regardless of date gaps → even spacing distorts the time trend; date labels at `fontSize: "9px"`.
- `src/components/TopBar.tsx:121-125` — `ALERTS` `StatPill` is the only one of four with no `onClick`.
- `src/components/TopBar.tsx:82-94` — logo uses `color: var(--accent-red)` (the danger semantic).
- Landmarks are **partial**: `TaskBoard.tsx:124` is `<main>`, but `ProjectList.tsx:39` (sidebar) and `AgentFeed.tsx:57` (feed) are **both** `<aside>` (ambiguous), and `DashboardView`/`ActivityStreamView` centers are plain `<div>`s.
- Scroll regions lack `tabIndex`: `DashboardView.tsx:147`, `ActivityStreamView.tsx:79`, `AgentDashboard.tsx:113/145/355`, and the `.panel-scroll` at `AgentFeed.tsx:218` / `KanbanColumn.tsx:138`.
- Target sizes < 24px: `ViewToggle` buttons (`topbar/styles.ts:3-10`, `padding: 4px 10px` + `fontSize: 12px` ≈ 22px), command-palette & appearance triggers.
- Sub-11px inline fonts: 33 occurrences across 10 `.tsx` files; `shared.ts:31-41 badgeStyle` hard-codes `10px`; `MilestoneCards.tsx:39` uses `9px`.

## Global constraints (apply to every plan)

- Node ≥20, ESM with explicit `.js` extensions on relative imports (even for `.ts`/`.tsx` sources).
- Styling: CSS variables + inline styles; **no CSS library**. Route text sizing through `typeScale` tokens in `src/styles/shared.ts`; grow `shared.ts` rather than hand-rolling new inline styles.
- Tests: Vitest. Component tests are `tests/components/*.test.tsx` (jsdom + `@testing-library/react`, setup in `tests/setup-dom.ts`). Run all with `npm test`.
- Full build gate: `npm run build` (`vite build && tsc --noEmit`) must pass.
- Before any commit that completes a task, run the **`finish-task`** skill (tests, code review, static analysis, review marker, tracking updates) per the user's global CLAUDE.md.
- Keep semantic status colors meaningful: `--accent-red`/`--status-danger` = blocked/overdue only.
