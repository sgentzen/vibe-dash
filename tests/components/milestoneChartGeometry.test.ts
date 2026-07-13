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

  it("keeps every bar within the [0,100] axis", () => {
    const layout = computeBarLayout(["2026-01-01", "2026-02-01", "2026-03-15", "2026-06-30"]);
    for (const b of layout) {
      expect(b.leftPct).toBeGreaterThanOrEqual(0);
      expect(b.leftPct + b.widthPct).toBeLessThanOrEqual(100 + 1e-9);
    }
  });
});
