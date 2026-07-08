# Honest Dashboard Charts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dashboard from showing decorative/misleading trends: remove the identical sparkline from the four KPI cards, and make the Milestone Progress chart plot a true proportional time axis with a selector to choose which open milestone it shows.

**Architecture:** Frontend-only. No backend/schema changes (per maintainer decision, per-metric history is out of scope). KPI change is a deletion. Milestone change adds a small pure geometry helper (unit-tested), a `<select>` in the card, and lifts the "which milestone" choice into `DashboardView` state so the existing `getMilestoneDailyStats` fetch targets the chosen milestone.

**Tech Stack:** React 19, existing `useApi` hook, Vitest.

## Global Constraints

- Node ≥20, ESM, explicit `.js` extensions on relative imports.
- No CSS library; route new text sizes through `typeScale` tokens.
- Component + logic tests via Vitest; build gate `npm run build`.
- Run the `finish-task` skill before the completing commit.

## File Structure

- `src/components/dashboard/KpiCard.tsx` — remove the now-unused `sparkline` prop + `Sparkline` import.
- `src/components/DashboardView.tsx` — remove `sparkline={…}` from the four cards; remove `computeActivityLast7` + `activityLast7` (dead after removal — `heatmap` is still used by `ActivityHeatmapCard`); add `selectedMilestoneId` state and pass it to `loadChartData`.
- `src/components/dashboard/MilestoneCards.tsx` — replace the `flex:1` bar row with proportional positioning via a new geometry helper; add a milestone `<select>`; raise the `9px` date labels to the `11px` floor (`typeScale.micro`).
- `src/components/dashboard/milestoneChartGeometry.ts` — **new**, pure helper `computeBarLayout()` (unit-tested).
- `tests/components/milestoneChartGeometry.test.ts` — **new** unit tests.
- `tests/components/DashboardView.test.tsx` — **new** (or extend) — assert no sparkline SVG renders in the KPI row.

---

### Task 1: Drop the misleading KPI sparklines

**Files:**
- Modify: `src/components/DashboardView.tsx:70-79` (delete helper), `:120-121` (delete `activityLast7`), `:170-197` (drop `sparkline` prop)
- Modify: `src/components/dashboard/KpiCard.tsx:1-19,53-58` (remove prop + import)
- Test: `tests/components/DashboardView.test.tsx`

**Interfaces:**
- Produces: `KpiCard` prop shape becomes `{ label, value, color, tooltip?, compact? }` (no `sparkline`). Update any other caller accordingly — grep confirms the only callers are in `DashboardView.tsx` (the KPI row and the cost row, which already pass no sparkline).

- [ ] **Step 1: Write the failing test**

Create `tests/components/DashboardView.test.tsx` (wrap with the store provider exactly as `tests/components/FleetView.test.tsx` does):

```tsx
import { render } from "@testing-library/react";
// import providers/mocks mirroring tests/components/FleetView.test.tsx
import { DashboardView } from "../../src/components/DashboardView.js";

it("KPI cards render no sparkline SVG (honest-absence over decorative trend)", () => {
  const { container } = render(/* <Providers><DashboardView/></Providers> */ null as never);
  // Sparkline is the only inline <svg> the KPI row would emit.
  const kpiSvgs = container.querySelectorAll("svg");
  expect(kpiSvgs.length).toBe(0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/DashboardView.test.tsx`
Expected: FAIL — four `<svg>` sparklines present.

- [ ] **Step 3: Remove the sparkline plumbing from `KpiCard`**

In `src/components/dashboard/KpiCard.tsx`: delete the `import { Sparkline } from "../Sparkline.js";` line, remove `sparkline?: number[];` from the prop type, remove `sparkline,` from the destructure, and delete the render block (`:55-57`):

```tsx
      {sparkline && sparkline.length >= 2 && (
        <Sparkline values={sparkline} width={60} height={16} color={color} />
      )}
```

- [ ] **Step 4: Remove the source data + props in `DashboardView`**

Delete `computeActivityLast7` (`:70-79`) and the `activityLast7` line (`:120-121`). Remove the four `sparkline={isCompact ? undefined : activityLast7}` lines (`:174,181,188,195`) and the now-orphan `compact={isCompact}` stays. `heatmap`/`setHeatmap` remain — still consumed by `ActivityHeatmapCard` (`:206`).

> Verify `computeActivityLast7` has no other importer before deleting (`grep -rn computeActivityLast7 src tests`). If a test referenced it, delete that test too.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- tests/components/DashboardView.test.tsx && npx tsc --noEmit`
Expected: PASS; no unused-symbol / type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/DashboardView.tsx src/components/dashboard/KpiCard.tsx tests/components/DashboardView.test.tsx
git commit -m "fix(dashboard): drop identical KPI sparklines (misleading per-metric trend)"
```

---

### Task 2: Milestone chart — true time axis (proportional x positioning)

**Files:**
- Create: `src/components/dashboard/milestoneChartGeometry.ts`
- Create: `tests/components/milestoneChartGeometry.test.ts`
- Modify: `src/components/dashboard/MilestoneCards.tsx:20-44`

**Interfaces:**
- Produces: `export function computeBarLayout(dates: string[], opts?: { minPct?: number }): { date: string; leftPct: number; widthPct: number }[]` — maps ISO date strings to horizontal position/width proportional to their real time span, so gaps between irregular dates render as gaps.

- [ ] **Step 1: Write the failing test**

Create `tests/components/milestoneChartGeometry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeBarLayout } from "../../src/components/dashboard/milestoneChartGeometry.js";

describe("computeBarLayout", () => {
  it("spaces bars proportionally to real date gaps", () => {
    // 04-15, 04-17 (2d gap) then 07-06 (huge gap) — must NOT be evenly spaced.
    const layout = computeBarLayout(["2026-04-15", "2026-04-17", "2026-07-06"]);
    expect(layout[0].leftPct).toBeCloseTo(0, 1);
    expect(layout[2].leftPct + layout[2].widthPct).toBeCloseTo(100, 1);
    // The 2-day gap is a tiny fraction of the ~82-day total span.
    expect(layout[1].leftPct).toBeLessThan(5);
  });

  it("handles a single date without dividing by zero", () => {
    const layout = computeBarLayout(["2026-04-15"]);
    expect(layout).toHaveLength(1);
    expect(layout[0].leftPct).toBe(0);
    expect(layout[0].widthPct).toBeGreaterThan(0);
  });

  it("returns [] for empty input", () => {
    expect(computeBarLayout([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/milestoneChartGeometry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/components/dashboard/milestoneChartGeometry.ts`:

```ts
export interface BarPosition {
  date: string;
  leftPct: number;
  widthPct: number;
}

// Positions each daily-stats bar along a true time axis. leftPct is the point's
// fraction of the total [first,last] span; widthPct gives each bar a small,
// uniform footprint centered on its position so bars stay visible even when
// dates cluster. Guards single/empty inputs against divide-by-zero.
export function computeBarLayout(dates: string[], opts?: { minPct?: number }): BarPosition[] {
  if (dates.length === 0) return [];
  const barW = opts?.minPct ?? 4; // visual width of each bar, in % of the axis
  const times = dates.map((d) => new Date(d).getTime());
  const first = times[0];
  const last = times[times.length - 1];
  const span = last - first || 1; // 1ms avoids /0 for a single date
  return dates.map((date, i) => {
    const frac = (times[i] - first) / span; // 0..1
    // Keep bars fully inside [0,100] by insetting the centerline by half a bar.
    const center = barW / 2 + frac * (100 - barW);
    return { date, leftPct: center - barW / 2, widthPct: barW };
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- tests/components/milestoneChartGeometry.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the helper in the chart (absolute positioning + 11px labels)**

In `src/components/dashboard/MilestoneCards.tsx`, replace the bar row and label row (`:20-45`) with proportionally-positioned bars. Import the helper and `typeScale`:

```tsx
import { computeBarLayout } from "./milestoneChartGeometry.js";
import { typeScale } from "../../styles/shared.js";
```

```tsx
        <div>
          {(() => {
            const layout = computeBarLayout(dailyStats.map((d) => d.date));
            const byDate = new Map(dailyStats.map((d) => [d.date, d]));
            return (
              <>
                <div style={{ position: "relative", height: "120px" }}>
                  {layout.map((b) => (
                    <div
                      key={b.date}
                      title={`${b.date}: ${byDate.get(b.date)!.completion_pct}%`}
                      style={{
                        position: "absolute",
                        left: `${b.leftPct}%`,
                        width: `${b.widthPct}%`,
                        bottom: 0,
                        background: "var(--accent-blue)",
                        borderRadius: "2px",
                        height: `${byDate.get(b.date)!.completion_pct}%`,
                        minHeight: "2px",
                      }}
                    />
                  ))}
                </div>
                {/* First / last date labels mark the true axis extent (11px floor). */}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-1)" }}>
                  <span style={{ ...typeScale.micro, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                    {dailyStats[0]?.date.slice(5)}
                  </span>
                  <span style={{ ...typeScale.micro, textTransform: "none", letterSpacing: 0, color: "var(--text-muted)" }}>
                    {dailyStats[dailyStats.length - 1]?.date.slice(5)}
                  </span>
                </div>
              </>
            );
          })()}
        </div>
```

> Rationale: per-bar `9px` labels are replaced with two axis-extent labels at the 11px floor. Even if you keep per-bar labels, they must be ≥11px (see the micro-polish plan).

- [ ] **Step 6: Verify live**

`preview_start`, open the dashboard with a project that has ≥3 irregular daily-stats dates. `preview_screenshot`: bars should cluster/gap by real time, not sit evenly. `preview_inspect` a date label for `font-size` ≥ `11px`.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/milestoneChartGeometry.ts tests/components/milestoneChartGeometry.test.ts src/components/dashboard/MilestoneCards.tsx
git commit -m "fix(dashboard): plot milestone progress on a true proportional time axis"
```

---

### Task 3: Milestone chart — selector to choose which open milestone

**Files:**
- Modify: `src/components/DashboardView.tsx:28-47` (`loadChartData` signature), `:99,132-136` (state + effect), `:201` (pass props)
- Modify: `src/components/dashboard/MilestoneCards.tsx:6-14` (props + `<select>`)
- Test: `tests/components/MilestoneProgressCard.test.tsx` (new)

**Interfaces:**
- Consumes: `openMilestones: Milestone[]` (already passed to the card).
- Produces: `MilestoneProgressCard` gains `selectedMilestoneId: string | null` and `onSelectMilestone: (id: string) => void`. `DashboardView` holds `const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null)` and derives the *effective* id as `selectedMilestoneId ?? firstOpenMilestoneId`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/MilestoneProgressCard.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MilestoneProgressCard } from "../../src/components/dashboard/MilestoneCards.js";

const milestones = [
  { id: "m1", name: "Alpha", status: "open" },
  { id: "m2", name: "Beta", status: "open" },
] as never[];

it("renders a selector and reports the chosen milestone", () => {
  const onSelect = vi.fn();
  render(
    <MilestoneProgressCard
      dailyStats={[]}
      openMilestones={milestones}
      selectedMilestoneId="m1"
      onSelectMilestone={onSelect}
    />
  );
  const select = screen.getByLabelText("Milestone") as HTMLSelectElement;
  expect(select.value).toBe("m1");
  fireEvent.change(select, { target: { value: "m2" } });
  expect(onSelect).toHaveBeenCalledWith("m2");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- tests/components/MilestoneProgressCard.test.tsx`
Expected: FAIL — no `Milestone` labelled control / props don't exist.

- [ ] **Step 3: Add selector to the card**

In `src/components/dashboard/MilestoneCards.tsx`, extend props and render a `<select>` in the card header area (only when ≥2 open milestones, otherwise the title already names the one):

```tsx
interface MilestoneProgressCardProps {
  dailyStats: MilestoneDailyStats[];
  openMilestones: Milestone[];
  selectedMilestoneId: string | null;
  onSelectMilestone: (id: string) => void;
}

export const MilestoneProgressCard = memo(function MilestoneProgressCard({
  dailyStats, openMilestones, selectedMilestoneId, onSelectMilestone,
}: MilestoneProgressCardProps) {
  const effectiveId = selectedMilestoneId ?? openMilestones[0]?.id ?? null;
  const selector = openMilestones.length > 1 ? (
    <select
      aria-label="Milestone"
      value={effectiveId ?? ""}
      onChange={(e) => onSelectMilestone(e.target.value)}
      style={{
        background: "var(--bg-tertiary)", border: "1px solid var(--border)",
        borderRadius: "6px", color: "var(--text-primary)",
        font: "var(--type-caption)", padding: "2px 6px", height: "26px",
      }}
    >
      {openMilestones.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  ) : null;

  return (
    <CardWrapper title="Milestone Progress" action={selector}>
      {/* …existing empty-state / chart body, now driven by dailyStats for effectiveId… */}
    </CardWrapper>
  );
});
```

> Check `src/components/ui/Card.tsx` for an existing `action`/header-slot prop. If `CardWrapper` has no such slot, add a small optional `action?: React.ReactNode` prop rendered right-aligned in its title row — that's a one-line addition and keeps the selector visually attached to the card. Do this as the first sub-step of Step 3.

- [ ] **Step 4: Lift selection into `DashboardView` and fetch the chosen milestone**

In `src/components/DashboardView.tsx`:

Add state (near `:99`):
```tsx
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
```
Compute the effective id after `firstOpenMilestoneId` (`:132`):
```tsx
  const effectiveMilestoneId =
    (selectedMilestoneId && openMilestones.some((m) => m.id === selectedMilestoneId))
      ? selectedMilestoneId
      : firstOpenMilestoneId;
```
Pass `effectiveMilestoneId` into `loadChartData` instead of `firstOpenMilestoneId` (`:135`) and add it to the effect deps (`:136`). Pass props to the card (`:201`):
```tsx
        <MilestoneProgressCard
          dailyStats={dailyStats}
          openMilestones={openMilestones}
          selectedMilestoneId={effectiveMilestoneId ?? null}
          onSelectMilestone={setSelectedMilestoneId}
        />
```

> The existing `loadChartData` already accepts a milestone id param (`firstOpenMilestoneId`) and calls `api.getMilestoneDailyStats(id)` — only the argument passed changes. No API change needed.

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- tests/components/MilestoneProgressCard.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Verify live**

`preview_start`, dashboard with ≥2 open milestones. `preview_snapshot` — a `Milestone` combobox is present. `preview_fill`/select the second option, then `preview_snapshot`/`preview_network` to confirm a `getMilestoneDailyStats` call for the new milestone id and the chart re-renders.

- [ ] **Step 7: Full build + test gate, then commit**

```bash
npm run build && npm test
git add src/components/DashboardView.tsx src/components/dashboard/MilestoneCards.tsx src/components/ui/Card.tsx tests/components/MilestoneProgressCard.test.tsx
git commit -m "feat(dashboard): add milestone selector to progress chart"
```

---

## Self-review checklist

- [ ] No `<svg>` sparkline renders in the KPI row; `computeActivityLast7` fully removed with no dangling importers.
- [ ] `KpiCard` prop type no longer has `sparkline`; all callers updated; `tsc --noEmit` clean.
- [ ] Milestone bars are proportionally positioned; single/empty date inputs don't throw.
- [ ] Selector appears only with ≥2 open milestones; changing it refetches + redraws.
- [ ] All new labels ≥11px.
