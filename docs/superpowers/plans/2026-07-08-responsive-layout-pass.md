# Responsive Layout Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard usable below ~1135px by letting the header shrink/wrap and turning the fixed three-column grid into a layout whose side rails become reachable off-canvas drawers at narrow widths.

**Architecture:** Pure CSS + minimal React state. Introduce breakpoint-driven rules in `src/App.css` and small style/markup changes in `TopBar.tsx` and `App.tsx`. Below `1024px` the left sidebar and right feed leave the grid flow and render as toggleable overlay drawers; the center column always fills the viewport. The header wraps/collapses instead of overflowing.

**Tech Stack:** React 19, CSS variables, no CSS library.

## Global Constraints

- Node ≥20, ESM, explicit `.js` extensions on relative imports.
- No CSS library; CSS variables + inline styles + `src/App.css` only.
- Component tests: `tests/components/*.test.tsx` (jsdom + `@testing-library/react`). Run `npm test`; build gate `npm run build`.
- Run the `finish-task` skill before the completing commit.
- `--accent-red` stays reserved for danger semantics.

## Breakpoints (single source of truth)

- `--bp-wide`: ≥1200px — full three-column grid (current behavior).
- `--bp-mid`: 1024–1199px — narrower rails (`180px 1fr 220px`), header may wrap.
- `--bp-narrow`: <1024px — rails leave flow, become overlay drawers; center is full-width; header collapses search + pills behind the grid.

CSS media queries can't read CSS custom properties, so these are documented here and written as literal `px` in `@media`.

## File Structure

- `src/App.css` — add `.app`/`.main-content` overflow fix + `@media` rules + `.drawer-overlay`, `.rail-drawer`, `.rail-collapsed-narrow` classes. (Primary change.)
- `src/components/TopBar.tsx` — add `min-width: 0` + `flex-wrap: wrap` to header; wrap the stat-pill cluster and search in a shrinkable group; add a narrow-width "menu" affordance is **not** needed (drawers are opened from the rails), but the header must never force horizontal overflow.
- `src/App.tsx` — add `railDrawerOpen` UI state (left/right), render backdrop + drawer toggle buttons that only appear at narrow widths (via a CSS class, not JS width-sniffing), and apply drawer classes to `ProjectList`/`AgentFeed`.
- `src/state/setReducer.ts` (+ `src/state/types.ts`) — **only if** you choose reducer-managed drawer state; otherwise keep it as local `useState` in `App.tsx` (recommended — it's ephemeral UI state). This plan uses local `useState`.
- `tests/components/TopBar.test.tsx` — assert header style contains `flexWrap`/`minWidth: 0` (guards the overflow regression).

---

### Task 1: Stop the app from clipping — header shrinks and wraps

**Files:**
- Modify: `src/components/TopBar.tsx:69-80` (header container), `:96-132` (stat cluster), `:140-203` (search group)
- Modify: `src/App.css:121-132`
- Test: `tests/components/TopBar.test.tsx`

**Interfaces:**
- Produces: no new exports. Header container gains `minWidth: 0`, `flexWrap: "wrap"`, `rowGap`.

- [ ] **Step 1: Write the failing test** — header must be wrap-enabled so it can't force overflow.

Add to `tests/components/TopBar.test.tsx` (mirror the existing render setup in that file):

```tsx
it("header is allowed to wrap so it never clips controls off-screen", () => {
  const { container } = renderTopBar(); // use the file's existing render helper
  const header = container.querySelector("header")!;
  expect(header).toBeTruthy();
  // Inline style is the source of truth for this component.
  expect(header.style.flexWrap).toBe("wrap");
  expect(header.style.minWidth).toBe("0px");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: FAIL — `flexWrap` is `""`.

- [ ] **Step 3: Make the header shrinkable/wrappable**

In `src/components/TopBar.tsx`, edit the `<header>` style object (`:70-79`):

```tsx
    <header
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        padding: "0 var(--space-4)",
        minHeight: "52px",           // was height: "52px" — allow growth when wrapped
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",            // NEW
        rowGap: "var(--space-2)",    // NEW — spacing between wrapped rows
        gap: "var(--space-4)",       // was var(--space-5); tighter so more fits per row
        minWidth: 0,                 // NEW — let the flex item shrink below content size
        overflow: "hidden",          // NEW — belt-and-suspenders against sub-pixel spill
      }}
    >
```

Wrap the stat-pill cluster (`:97`) and the search group (`:141`) each in a `min-width: 0` container so they shrink rather than push:

```tsx
      {/* Stats */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", minWidth: 0, flexShrink: 1 }}>
```
```tsx
      {/* Search: scope + input + kbd hint */}
      <div style={{ display: "flex", alignItems: "center", gap: "0", position: "relative", minWidth: 0, flexShrink: 1 }}>
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Fix the app shell so a wrapped/oversized header can't be clipped**

In `src/App.css`, change the app shell so vertical growth is tolerated and horizontal overflow never silently hides controls:

```css
.app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  overflow: hidden;
  min-width: 0; /* NEW: children may shrink below their content width */
}

.main-content {
  display: grid;
  grid-template-columns: 200px 1fr 240px;
  overflow: hidden;
  min-width: 0; /* NEW */
}

/* Every direct grid child must be allowed to shrink, or the 1fr center
   column will be pushed and clip the rails. */
.main-content > * {
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 6: Verify live at the previously-broken width**

Start the dev server (`preview_start`), then `preview_resize` to 800×800 and `preview_snapshot`. Confirm the command-palette button, appearance button, and "+ New Project" control are all present in the accessibility tree (they were unreachable before). `preview_screenshot` for the record.

- [ ] **Step 7: Commit**

```bash
git add src/components/TopBar.tsx src/App.css tests/components/TopBar.test.tsx
git commit -m "fix(ui): let top bar wrap so controls stop clipping below ~1135px"
```

---

### Task 2: Narrow-width breakpoints — side rails become off-canvas drawers

**Files:**
- Modify: `src/App.css` (add `@media` blocks + drawer classes)
- Modify: `src/App.tsx:233-292` (drawer state, backdrop, toggle buttons, rail classes)
- Test: `tests/components/*.test.tsx` (new `tests/components/RailDrawers.test.tsx`)

**Interfaces:**
- Consumes: existing `rightRailCollapsed` nav state (unchanged) for the ≥1024px right-rail collapse behavior.
- Produces: local `App` state `const [drawer, setDrawer] = useState<null | "left" | "right">(null)`. Drawers are opened by two edge toggle buttons that are visible only under 1024px (`.rail-toggle` shown via media query). Backdrop click / `Escape` closes.

- [ ] **Step 1: Add breakpoint grid + drawer CSS**

Append to `src/App.css`:

```css
/* ---- Responsive: mid width — tighten rails ---- */
@media (max-width: 1199px) {
  .main-content {
    grid-template-columns: 180px 1fr 220px;
  }
}

/* ---- Responsive: narrow — rails leave flow, become overlay drawers ---- */
@media (max-width: 1023px) {
  .main-content {
    grid-template-columns: 1fr; /* center column fills the viewport */
  }
  /* Take the two rails out of the grid; position them as slide-in overlays. */
  .main-content > .rail-drawer {
    position: fixed;
    top: 52px;                 /* below the header */
    bottom: 0;
    width: min(80vw, 300px);
    z-index: 200;
    transform: translateX(var(--rail-hidden-x));
    transition: transform 0.2s ease-out;
    box-shadow: var(--shadow-lg);
  }
  .rail-drawer.rail-left  { left: 0;  --rail-hidden-x: -100%; }
  .rail-drawer.rail-right { right: 0; --rail-hidden-x: 100%; }
  .rail-drawer.rail-open  { transform: translateX(0); }

  .rail-toggle { display: inline-flex; } /* edge buttons visible only here */
  .drawer-backdrop {
    position: fixed; inset: 52px 0 0 0;
    background: rgba(0,0,0,0.5); z-index: 150;
  }
}

/* Edge toggle buttons are hidden at wide widths (drawers don't exist there). */
.rail-toggle { display: none; }

@media (prefers-reduced-motion: reduce) {
  .main-content > .rail-drawer { transition: none; }
}
```

- [ ] **Step 2: Wire drawer state + markup in `App.tsx`**

In `src/App.tsx`, add state near the other `useState` calls (`:27-32`):

```tsx
  const [drawer, setDrawer] = useState<null | "left" | "right">(null);
```

Close on `Escape` — extend the existing keydown handler (`:72-75`) so `Escape` also clears the drawer:

```tsx
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        setDrawer(null);
        return;
      }
```

Update the `.main-content` subtree (`:236-292`). Give `ProjectList` and `AgentFeed` the drawer classes, add two edge toggle buttons, and a backdrop:

```tsx
      <div className={`main-content${rightRailCollapsed ? " rail-collapsed" : ""}`}>
        {/* Left rail: normal grid cell at wide widths; overlay drawer when narrow */}
        <div className={`rail-drawer rail-left${drawer === "left" ? " rail-open" : ""}`}>
          <ProjectList />
        </div>

        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          {/* edge toggles — only rendered/visible under 1024px via .rail-toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0, gap: "8px", minHeight: "32px" }}>
            <button className="rail-toggle" aria-label="Open projects" onClick={() => setDrawer("left")}
              style={edgeToggleStyle}>☰ Projects</button>
            <ProjectContextChip />
            <button className="rail-toggle" aria-label="Open agent feed" onClick={() => setDrawer("right")}
              style={edgeToggleStyle}>Agents</button>
          </div>
          {(() => {
            if (activeView === "board") return <TaskBoard />;
            if (activeView === "feed") return <ActivityStreamView />;
            return <FleetView />;
          })()}
        </div>

        {/* Right rail: existing collapse behavior at wide widths; overlay when narrow */}
        <div className={`rail-drawer rail-right${drawer === "right" ? " rail-open" : ""}`}>
          {rightRailCollapsed ? (
            <aside /* …existing collapsed-rail markup unchanged… */ />
          ) : (
            <AgentFeed onCollapse={() => dispatch({ type: "TOGGLE_RIGHT_RAIL" })} />
          )}
        </div>

        {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(null)} />}
      </div>
```

Define `edgeToggleStyle` near the top of the component body (reuse existing token values):

```tsx
  const edgeToggleStyle: React.CSSProperties = {
    background: "var(--bg-tertiary)", border: "1px solid var(--border)",
    borderRadius: "6px", color: "var(--text-secondary)", padding: "4px 10px",
    fontSize: "var(--type-caption)", cursor: "pointer", whiteSpace: "nowrap",
  };
```

> Note: the `.rail-toggle { display: none }` default keeps both buttons hidden at wide widths, so the center header row is visually unchanged there. Only the media query reveals them.

- [ ] **Step 3: Write a behavior test for the drawer toggle**

Create `tests/components/RailDrawers.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "../../src/App.js";
// If <App/> needs the store provider, wrap it exactly as tests/components/TopBar.test.tsx does.

it("opens the projects drawer and closes it via backdrop", async () => {
  render(/* <Providers><App/></Providers> */ null as never);
  const openBtn = await screen.findByLabelText("Open projects");
  fireEvent.click(openBtn);
  expect(document.querySelector(".rail-left.rail-open")).toBeTruthy();
  fireEvent.click(document.querySelector(".drawer-backdrop")!);
  expect(document.querySelector(".rail-left.rail-open")).toBeFalsy();
});
```

If `<App/>` is too heavy to mount in jsdom (it kicks off data loading), instead extract the drawer markup into a small presentational `RailDrawers` component and test that in isolation. Prefer extraction — it keeps the test fast and deterministic.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/components/RailDrawers.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify responsive behavior live**

`preview_resize` to `preset: "tablet"` (768px). `preview_snapshot` — center column should be full-width, both edge toggles present. `preview_click` the "Open projects" toggle, `preview_snapshot` — `.rail-left.rail-open` present and ProjectList content visible. Click backdrop, confirm it closes. Then `preview_resize` to `desktop` (1280px) and confirm the three-column grid is back and edge toggles are hidden. Screenshot both states.

- [ ] **Step 6: Full build + test gate**

Run: `npm run build && npm test`
Expected: build passes, all green.

- [ ] **Step 7: Commit**

```bash
git add src/App.css src/App.tsx tests/components/RailDrawers.test.tsx
git commit -m "feat(ui): collapse side rails into overlay drawers below 1024px"
```

---

## Self-review checklist

- [ ] At 800px, every top-bar control is in the a11y tree and reachable (Task 1 Step 6).
- [ ] At <1024px, both rails are reachable via edge toggles; backdrop + `Escape` close them (Task 2).
- [ ] At ≥1200px, layout is pixel-identical to today (toggles hidden, grid `200px 1fr 240px`).
- [ ] No `@media` rule references a CSS custom property (they can't be read in media queries).
- [ ] `--accent-red` untouched.
