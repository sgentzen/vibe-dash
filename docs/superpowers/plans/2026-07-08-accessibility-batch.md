# Accessibility Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the axe-flagged issues the dev console already lists: give the page a correct landmark structure (one `<main>`, a `<nav>` sidebar, disambiguated `<aside>` feed), make scrollable panels keyboard-focusable, and raise sub-24px interactive targets to the WCAG 2.5.8 minimum.

**Architecture:** Small, surgical markup/style edits across existing components. No new components. Verification leans on the project's existing dev axe integration plus `@testing-library` role queries.

**Tech Stack:** React 19, `@testing-library/react` + jsdom, existing dev-time axe.

## Global Constraints

- Node ≥20, ESM, explicit `.js` extensions on relative imports.
- No CSS library. Target-size bumps go through shared style objects where they exist (`topbar/styles.ts`).
- Tests via Vitest; build gate `npm run build`.
- Run the `finish-task` skill before the completing commit.

## Current landmark reality (verified)

- `TaskBoard.tsx:124` → `<main>` ✅ (but only on the board view).
- `ProjectList.tsx:39` → `<aside className="panel-scroll sidebar">` — should be the `<nav>`.
- `AgentFeed.tsx:57` → `<aside className="panel-scroll">` — correct element but **unlabelled**, and it collides with the sidebar `<aside>`.
- `DashboardView.tsx:147`, `ActivityStreamView.tsx:79` centers → plain `<div>` (no landmark).
- Collapsed right rail (`App.tsx:260`) → `<aside>` (also unlabelled).

**Chosen structure:** exactly one `<main>` = the center column (in `App.tsx`), the left sidebar = `<nav aria-label="Projects">`, the right feed = `<aside aria-label="Agent feed">`. `TaskBoard`'s `<main>` becomes a `<div>` to avoid nested/duplicate `main`.

## File Structure

- `src/App.tsx` — wrap the center column (`:238`) in a single `<main aria-label="…">`; label both right-rail `<aside>` variants.
- `src/components/TaskBoard.tsx:124` — `<main>` → `<div>` (center is now the app-level `<main>`).
- `src/components/ProjectList.tsx:39` — `<aside>` → `<nav aria-label="Projects">`.
- `src/components/AgentFeed.tsx:57` — add `aria-label="Agent feed"`.
- Scroll regions — add `tabIndex={0}` + `aria-label` to focusable-but-unlabelled scroll containers: `DashboardView.tsx:147`, `ActivityStreamView.tsx:79`, `AgentDashboard.tsx:113/145/355`, `AgentFeed.tsx:218`, `board/KanbanColumn.tsx:138`.
- `src/components/topbar/styles.ts:3-10` — bump `viewBtnStyle` vertical padding to reach ≥24px.
- `src/components/TopBar.tsx:205-227,234-252` — bump command-palette + appearance trigger padding to ≥24px min-height.
- Tests: `tests/components/landmarks.test.tsx` (new), extend `tests/components/TopBar.test.tsx`.

---

### Task 1: One `<main>`, a `<nav>` sidebar, labelled `<aside>` feed

**Files:**
- Modify: `src/App.tsx:238-258` (center → `<main>`), `:260,289` (aside labels)
- Modify: `src/components/TaskBoard.tsx:124` and its closing tag
- Modify: `src/components/ProjectList.tsx:39` and its closing tag
- Modify: `src/components/AgentFeed.tsx:57`
- Test: `tests/components/landmarks.test.tsx`

**Interfaces:** no exported API changes — markup only.

- [ ] **Step 1: Write the failing test**

Create `tests/components/landmarks.test.tsx` — assert the three landmark roles resolve uniquely. If mounting `<App/>` is impractical in jsdom (it triggers data loading), assert per-component instead: render `<ProjectList/>` and query `getByRole("navigation", { name: "Projects" })`; render `<AgentFeed onCollapse={()=>{}} />` and query `getByRole("complementary", { name: "Agent feed" })`. Example for the sidebar:

```tsx
import { render, screen } from "@testing-library/react";
import { ProjectList } from "../../src/components/ProjectList.js";
// wrap in the store provider exactly as tests/components/ProjectList.test.tsx does

it("sidebar exposes a labelled navigation landmark", () => {
  render(/* <Providers><ProjectList/></Providers> */ null as never);
  expect(screen.getByRole("navigation", { name: "Projects" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/landmarks.test.tsx`
Expected: FAIL — sidebar is `<aside>` (role `complementary`), not `navigation`.

- [ ] **Step 3: Sidebar → `<nav>`**

`src/components/ProjectList.tsx:39-40`:

```tsx
    <nav
      aria-label="Projects"
      className={`panel-scroll ${SIDEBAR_CLASS}`}
```

Update the matching closing tag from `</aside>` to `</nav>`.

- [ ] **Step 4: Center column → the single `<main>`; demote TaskBoard's**

`src/App.tsx:238` — change the center column wrapper `<div style={{ display: "flex", flexDirection: "column", … }}>` to:

```tsx
        <main
          aria-label="Main content"
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}
        >
```
…and its closing `</div>` (`:258`) to `</main>`.

`src/components/TaskBoard.tsx:124` — change `<main …>` to `<div …>` (keep the same style/props) and its closing `</main>` to `</div>`. TaskBoard now renders *inside* the app-level `<main>`, so it must not be a landmark itself.

- [ ] **Step 5: Label both right-rail `<aside>`s**

`src/components/AgentFeed.tsx:57` — add `aria-label="Agent feed"` to the `<aside>`.
`src/App.tsx:260` — add `aria-label="Agent feed (collapsed)"` to the collapsed-rail `<aside>`.

- [ ] **Step 6: Run tests**

Run: `npm test -- tests/components/landmarks.test.tsx`
Expected: PASS.

- [ ] **Step 7: Verify axe is quiet on landmarks**

`preview_start`, load the app, `preview_console_logs level: "warn"`. Confirm the "All page content should be contained by landmarks" / region violations are gone. Repeat after switching to Board and Feed views (`preview_click` the view toggle) so all three center views are checked. Screenshot the clean console.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/components/TaskBoard.tsx src/components/ProjectList.tsx src/components/AgentFeed.tsx tests/components/landmarks.test.tsx
git commit -m "a11y: give the page a single main, nav sidebar, and labelled feed aside"
```

---

### Task 2: Make scrollable panels keyboard-focusable

**Files:**
- Modify: `src/components/DashboardView.tsx:147`, `ActivityStreamView.tsx:79`, `AgentDashboard.tsx:113,145,355`, `AgentFeed.tsx:218`, `board/KanbanColumn.tsx:138`

**Interfaces:** markup only.

- [ ] **Step 1: Add `tabIndex` + label to each scroll container**

For each `overflow-y: auto` / `.panel-scroll` container that is a scroll region without its own focusable descendants covering the whole area, add `tabIndex={0}` and an `aria-label`. Example — `src/components/DashboardView.tsx:147`:

```tsx
    <div tabIndex={0} aria-label="Dashboard" role="region"
         style={{ flex: 1, padding: "var(--space-4)", overflowY: "auto" }}>
```

Apply the same pattern:
- `ActivityStreamView.tsx:79` → `aria-label="Activity feed"`
- `AgentDashboard.tsx:113/145/355` → `aria-label="Agent dashboard"` (use a distinct label per panel if they coexist)
- `AgentFeed.tsx:218` (`.panel-scroll` list) → `aria-label="Agent activity"`
- `board/KanbanColumn.tsx:138` (`.panel-scroll` column) → give a label from the column's status name already in scope (e.g. `aria-label={\`${title} column\`}`)

> Keep `role="region"` only where a label is present (a labelled region becomes a navigable landmark; that's desirable for these large scroll panels). Do **not** add `role="region"` to the Kanban columns if they already sit inside a labelled board — a `tabIndex={0}` + `aria-label` is enough there.

- [ ] **Step 2: Write a focusability test (representative)**

Extend an existing suite (e.g. add to `tests/components/AgentDashboard.test.tsx`) asserting the scroll container is focusable:

```tsx
it("dashboard scroll region is keyboard-focusable and labelled", () => {
  const { container } = render(/* … */ null as never);
  const region = container.querySelector('[aria-label="Agent dashboard"]')!;
  expect(region.getAttribute("tabindex")).toBe("0");
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/components/AgentDashboard.test.tsx`
Expected: PASS.

- [ ] **Step 4: Verify keyboard scroll + axe**

`preview_start`. Tab to the dashboard region (`preview_eval: document.activeElement?.getAttribute('aria-label')` after simulated tabbing, or `preview_snapshot` to confirm focus order includes the region). Confirm axe's "Scrollable region must have keyboard access" violation is cleared in `preview_console_logs`.

- [ ] **Step 5: Commit**

```bash
git add src/components/DashboardView.tsx src/components/ActivityStreamView.tsx src/components/AgentDashboard.tsx src/components/AgentFeed.tsx src/components/board/KanbanColumn.tsx tests/components/AgentDashboard.test.tsx
git commit -m "a11y: make scrollable panels keyboard-focusable with labels"
```

---

### Task 3: Raise interactive targets to ≥24px (WCAG 2.5.8)

**Files:**
- Modify: `src/components/topbar/styles.ts:3-10` (`viewBtnStyle`)
- Modify: `src/components/TopBar.tsx:210-224` (command palette btn), `:238-250` (appearance btn)
- Test: extend `tests/components/TopBar.test.tsx`

**Interfaces:** `viewBtnStyle` values change only.

- [ ] **Step 1: Write the failing test**

Add to `tests/components/TopBar.test.tsx`:

```tsx
it("view-toggle buttons meet the 24px minimum target height", () => {
  const { getByText } = renderTopBar();
  const btn = getByText("Board").closest("button")!;
  // 5px top + 5px bottom padding + ~14px line-box ≈ ≥24px; assert the padding we set.
  expect(btn.style.minHeight).toBe("24px");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: FAIL — no `minHeight`.

- [ ] **Step 3: Bump the shared toggle style**

`src/components/topbar/styles.ts:3-10`:

```ts
export const viewBtnStyle: CSSProperties = {
  border: "none",
  borderRadius: "4px",
  padding: "5px 12px",   // was 4px 10px
  minHeight: "24px",     // NEW — WCAG 2.5.8 floor
  fontSize: "12px",
  cursor: "pointer",
  fontWeight: 500,
};
```

- [ ] **Step 4: Bump the command-palette + appearance triggers**

In `src/components/TopBar.tsx`, add `minHeight: "24px"` (and keep `padding: "4px 8px"`) to the command-palette button style (`:210-224`) and the appearance button style (`:238-250`). The search `<select>`/`<input>`/`<kbd>` are already 28px — leave them.

- [ ] **Step 5: Run tests**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify measured sizes live**

`preview_start`, then `preview_inspect` the Fleet/Board/Feed buttons and the palette/appearance buttons; confirm each bounding box height ≥ 24px in both `light` and `dark` (`preview_resize colorScheme`).

- [ ] **Step 7: Full build + test gate, then commit**

```bash
npm run build && npm test
git add src/components/topbar/styles.ts src/components/TopBar.tsx tests/components/TopBar.test.tsx
git commit -m "a11y: raise view-toggle and top-bar targets to the 24px minimum"
```

---

## Self-review checklist

- [ ] Exactly one `<main>` in the DOM on every view (Board included — TaskBoard demoted).
- [ ] Sidebar is `navigation` "Projects"; feed is `complementary` "Agent feed"; no duplicate unlabelled asides.
- [ ] Every large scroll panel has `tabIndex={0}` + a label; axe scroll-region violation cleared.
- [ ] Fleet/Board/Feed toggles + palette + appearance buttons measure ≥24px tall.
- [ ] axe console shows no new landmark/label/target violations across Fleet, Board, Feed.
