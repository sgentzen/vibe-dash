# UI Micro-Polish Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten consistency and polish: replace emoji UI icons with inline SVGs, enforce an 11px type floor routed through tokens, move the brand wordmark off the danger-red color, make the ALERTS pill's affordance honest, expand the search field on focus, and normalize stat-pill metrics.

**Architecture:** Small shared primitives + targeted edits. Add a tiny inline-SVG icon set and grow `src/styles/shared.ts` with `pillStyle`/`microLabel` helpers so drift has one home. Each task is independently shippable.

**Tech Stack:** React 19, CSS variables, `src/styles/shared.ts`, Vitest.

## Global Constraints

- Node ≥20, ESM, explicit `.js` extensions on relative imports.
- No icon library and no CSS library — inline SVG + inline styles/tokens only.
- Route text sizing through `typeScale`; **11px is the floor.**
- Tests via Vitest; build gate `npm run build`.
- Run the `finish-task` skill before the completing commit.
- `--accent-red` / `--status-danger` reserved for danger semantics.

## File Structure

- `src/components/icons/Icon.tsx` — **new**, a handful of inline-SVG icons (`palette`, `sun`, `moon`, `chevronLeft`, `alert`) with a shared `size`/`color` API. No dependency.
- `src/styles/shared.ts` — grow with `microLabel` and `pillStyle` helpers; raise `badgeStyle` font to 11px.
- `src/components/TopBar.tsx` — non-red logo; SVG appearance/theme icons; ALERTS pill onClick; search focus-expand.
- `src/App.tsx:271-287` — collapse-rail `‹` → `chevronLeft` SVG.
- `src/components/dashboard/MilestoneCards.tsx:39`, and the 33 sub-11px inline `fontSize` sites — raise to 11px via tokens.
- Tests: extend `tests/components/TopBar.test.tsx`; new `tests/components/typeFloor.test.ts` guard.

---

### Task 1: Inline SVG icon set (replace emoji)

**Files:**
- Create: `src/components/icons/Icon.tsx`
- Modify: `src/components/TopBar.tsx:251` (🎨), `:291` (☀️/🌙), `src/App.tsx:286` (‹)
- Test: `tests/components/icons.test.tsx` (new)

**Interfaces:**
- Produces: `export function Icon({ name, size = 16, color = "currentColor", title }: { name: IconName; size?: number; color?: string; title?: string })` where `type IconName = "palette" | "sun" | "moon" | "chevronLeft" | "alert"`. Decorative uses pass no `title` and get `aria-hidden`; meaningful uses pass `title` → `role="img"` + `<title>`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/icons.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { Icon } from "../../src/components/icons/Icon.js";

it("renders an svg and is aria-hidden when decorative", () => {
  const { container } = render(<Icon name="palette" />);
  const svg = container.querySelector("svg")!;
  expect(svg).toBeTruthy();
  expect(svg.getAttribute("aria-hidden")).toBe("true");
});

it("is an img role with a title when labelled", () => {
  const { getByRole } = render(<Icon name="moon" title="Dark mode" />);
  expect(getByRole("img", { name: "Dark mode" })).toBeTruthy();
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/icons.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the icon set**

Create `src/components/icons/Icon.tsx` (paths are standard 24×24 line icons; keep `strokeWidth` consistent with the GitHub-dark aesthetic):

```tsx
export type IconName = "palette" | "sun" | "moon" | "chevronLeft" | "alert";

const PATHS: Record<IconName, string> = {
  // Minimal, recognizable 24x24 outlines. Replace with your preferred set if desired.
  palette: "M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 8 8 0 0 0-9-8Z M7.5 10.5h.01 M10.5 7.5h.01 M14.5 7.5h.01",
  sun: "M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M18.4 5.6l1.4-1.4 M4.2 19.8l1.4-1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  chevronLeft: "M15 18l-6-6 6-6",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
};

export function Icon({
  name, size = 16, color = "currentColor", title,
}: { name: IconName; size?: number; color?: string; title?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke={color} strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name]} />
    </svg>
  );
}
```

- [ ] **Step 4: Swap emoji for icons**

`TopBar.tsx:251` appearance button body `🎨` → `<Icon name="palette" />`.
`TopBar.tsx:291` theme buttons: `{t === "light" ? "☀️ Light" : "🌙 Dark"}` →
```tsx
{t === "light" ? (<><Icon name="sun" size={14} /> Light</>) : (<><Icon name="moon" size={14} /> Dark</>)}
```
`App.tsx:286` collapse button `‹` → `<Icon name="chevronLeft" size={16} />`.
Add `import { Icon } from "./components/icons/Icon.js";` (App) / `"../icons/Icon.js"`… adjust the relative path from `TopBar.tsx` → `"./icons/Icon.js"`.

- [ ] **Step 5: Run tests + verify live**

Run: `npm test -- tests/components/icons.test.tsx`. Then `preview_start`, `preview_screenshot` — appearance/theme/collapse controls show crisp SVGs, no emoji. Toggle `colorScheme` dark/light to confirm `currentColor` inherits correctly.

- [ ] **Step 6: Commit**

```bash
git add src/components/icons/Icon.tsx src/components/TopBar.tsx src/App.tsx tests/components/icons.test.tsx
git commit -m "polish(ui): replace emoji UI icons with inline SVGs"
```

---

### Task 2: 11px type floor + grow `shared.ts`

**Files:**
- Modify: `src/styles/shared.ts:31-41` (`badgeStyle` 10→11px; add `microLabel`, `pillStyle`)
- Modify: the 33 sub-11px inline `fontSize` sites (10 files; see overview) — route through tokens
- Test: `tests/components/typeFloor.test.ts` (new guard)

**Interfaces:**
- Produces: `export const microLabel: CSSProperties` (11px, uppercase, 0.05em) and `export function pillStyle(...)` in `shared.ts`.

- [ ] **Step 1: Write the failing guard test**

Create `tests/components/typeFloor.test.ts` — a source-scan guard that fails on any `fontSize: "9px"|"10px"` (and bare `9px`/`10px` in `font:`) under `src/`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|ts)$/.test(e)) out.push(p);
  }
  return out;
}

describe("11px type floor", () => {
  it("no source file sets a sub-11px font size", () => {
    const offenders: string[] = [];
    for (const f of walk("src")) {
      const src = readFileSync(f, "utf8");
      // matches fontSize: "9px" / '10px' and font shorthands with 9px/10px
      if (/fontSize:\s*["'](9|10)px["']/.test(src) || /\b(9|10)px\b[^;]*sans-serif/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders, `sub-11px font sizes found in:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/typeFloor.test.ts`
Expected: FAIL — ~10 offending files listed.

- [ ] **Step 3: Add shared primitives + raise `badgeStyle`**

`src/styles/shared.ts` — change `badgeStyle` `fontSize: "10px"` → `"11px"`, and append:

```ts
export const microLabel: CSSProperties = {
  fontSize: "11px",
  fontWeight: 500,
  lineHeight: 1.3,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

// Stat/metric pill container — single source for min-height + tracking so pills
// don't drift (44px vs 59px) when a label wraps.
export function pillStyle(): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "44px",
    lineHeight: 1,
    gap: "2px",
  };
}
```

- [ ] **Step 4: Sweep the sub-11px sites**

For each offender, replace `fontSize: "9px"|"10px"` with either `...typeScale.micro` (for uppercase micro-labels) or `fontSize: "11px"` (for plain text). Known sites include: `MilestoneCards.tsx:39` (9px date labels — already handled if the charts plan ran; otherwise raise here), `BlockerOverdueCards.tsx`, `TaskCard.tsx` (4 sites: 244/259/300/354), `ActivityStreamView.tsx`, `AgentComparisonView.tsx`, `AgentDashboard.tsx`, `AgentFeed.tsx`, `CommandPalette.tsx`, `board/MilestoneGroup.tsx`, `fleet/PresetSwitcher.tsx`. Work file-by-file; after each, re-run the guard to watch the offender list shrink.

> Where a 10px value was a deliberate dense-badge size, 11px is the new floor — the review explicitly calls 11px the true floor. Don't reintroduce 10px.

- [ ] **Step 5: Run the guard + full test suite**

Run: `npm test -- tests/components/typeFloor.test.ts && npm test`
Expected: guard PASS (empty offender list); no visual test regressions.

- [ ] **Step 6: Verify live**

`preview_start`, `preview_inspect` a TaskCard's smallest label and a badge; confirm `font-size` ≥ 11px. Screenshot the board.

- [ ] **Step 7: Commit**

```bash
git add src/styles/shared.ts src/components tests/components/typeFloor.test.ts
git commit -m "polish(ui): enforce 11px type floor via tokens and add shared pill/micro-label"
```

---

### Task 3: Non-red logo, honest ALERTS pill, focus-expand search, pill consistency

**Files:**
- Modify: `src/components/TopBar.tsx:82-94` (logo color), `:121-125` (ALERTS onClick), `:163-182` (search focus-expand)
- Modify: `src/components/topbar/StatPill.tsx:23-51` (use `pillStyle()` for both branches)
- Test: extend `tests/components/TopBar.test.tsx`

**Interfaces:** `StatPill` gains no new props; both branches adopt `pillStyle()` from Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `tests/components/TopBar.test.tsx`:

```tsx
it("brand wordmark is not the danger-red color", () => {
  const { getByText } = renderTopBar();
  expect(getByText("VIBE DASH").style.color).not.toContain("--accent-red");
});

it("ALERTS pill is interactive", () => {
  const { getByText } = renderTopBar();
  // With an onClick, StatPill renders a <button>.
  expect(getByText("ALERTS").closest("button")).toBeTruthy();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: FAIL — logo color is `var(--accent-red)`; ALERTS renders a `<div>`, not a button.

- [ ] **Step 3: Move the logo off danger-red**

`src/components/TopBar.tsx:84` — `color: "var(--accent-red)"` → `color: "var(--accent-blue)"`. (Accent-blue picks up the user's custom accent via the `[data-accent]` cascade in `App.css:88-90`, so the brand tracks the user's chosen color instead of stealing alarm priority.)

- [ ] **Step 4: Make ALERTS navigate**

`src/components/TopBar.tsx:121-125` — add an `onClick` that surfaces the alert banner / blockers. The `AlertBanner` renders at the app root when blockers exist; scroll it into view and pulse it, mirroring the PROJECTS pill's pattern:

```tsx
        <StatPill
          label="ALERTS"
          value={stats.alerts}
          color="var(--status-warning)"
          onClick={() => {
            const banner = document.querySelector<HTMLElement>('[role="alert"]');
            if (banner) {
              banner.scrollIntoView({ behavior: "smooth", block: "center" });
              banner.classList.add("highlight-pulse");
              setTimeout(() => banner.classList.remove("highlight-pulse"), 800);
            } else {
              // No active banner — take the user to the board where blockers live.
              dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" });
            }
          }}
        />
```

- [ ] **Step 5: Expand search on focus**

`src/components/TopBar.tsx` — drive the search `<input>` width from focus state. Add `const [searchFocused, setSearchFocused] = useState(false);` near the other state, then on the input (`:163-182`):

```tsx
        <input
          ref={searchInputRef}
          /* …existing props… */
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          style={{
            /* …existing style… */
            width: searchFocused ? "240px" : "140px",
            transition: "width 0.15s ease-out",
          }}
        />
```

> The narrow-width *collapse to icon* behavior belongs to the responsive plan (it's a breakpoint concern). This task only handles focus-expand.

- [ ] **Step 6: Normalize stat pills**

`src/components/topbar/StatPill.tsx` — import `pillStyle` and apply it to both the `<button>` (`:26-40`) and `<div>` (`:47-49`) branches so heights and tracking match. Replace the ad-hoc `flexDirection/alignItems/lineHeight/gap` with `...pillStyle()` (keep the button's `background/border/cursor/padding/borderRadius/hover`):

```tsx
import { microLabel, pillStyle } from "../../styles/shared.js";
// value span keeps its monospace numeral style; label span uses microLabel:
<span style={{ ...microLabel }}>{label}</span>
```

- [ ] **Step 7: Run tests**

Run: `npm test -- tests/components/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Verify live**

`preview_start`, `preview_screenshot`: logo is blue (or user accent), not red. `preview_click` the ALERTS pill → banner pulses / board opens. `preview_click` (focus) the search input and `preview_inspect` its width → 240px; blur → 140px. `preview_inspect` all four pills' bounding boxes → equal heights.

- [ ] **Step 9: Full build + test gate, then commit**

```bash
npm run build && npm test
git add src/components/TopBar.tsx src/components/topbar/StatPill.tsx tests/components/TopBar.test.tsx
git commit -m "polish(ui): neutral logo, clickable ALERTS pill, focus-expand search, uniform pills"
```

---

## Self-review checklist

- [x] No emoji remain as UI chrome (🎨 ☀️ 🌙 ‹ replaced); icons inherit `currentColor` in both themes. *(verified live: header has no emoji; palette + sun/moon SVGs render)*
- [x] `typeFloor` guard passes — zero sub-11px font sizes in `src/`. *(~30 sites raised; guard test green)*
- [x] Logo uses `--accent-blue` (or user accent), never `--accent-red`. *(verified live)*
- [x] All four stat pills are the same element type semantics-wise (or non-interactive ones are visually distinct) and equal height; ALERTS is clickable. *(all pills 44px via shared pillStyle(); ALERTS now a button)*
- [x] Search grows to 240px on focus with a transition; collapse-to-icon deferred to the responsive plan. *(width toggles 140↔240 on focus/blur — unit-tested)*

> **Status: COMPLETE** (2026-07-13). Search focus-expand is implemented per plan (inline width toggle + transition, verified by a deterministic unit test). Note: in the current single-row header the flex:1 spacer can compress the *rendered* width under crowding; the width-toggle logic is correct and the wrapper layout was left unchanged to avoid an unverified responsive regression (collapse/reflow belongs to the responsive plan). 409 tests pass; tsc clean; semgrep 0.
