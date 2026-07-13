// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MilestoneProgressCard } from "../../src/components/dashboard/MilestoneCards";
import type { Milestone, MilestoneDailyStats } from "../../src/types";

function makeMilestone(id: string, name: string): Milestone {
  return {
    id,
    project_id: "p1",
    name,
    description: null,
    acceptance_criteria: "[]",
    target_date: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("MilestoneProgressCard", () => {
  it("renders a selector and reports the chosen milestone (>=2 open)", () => {
    const onSelect = vi.fn();
    render(
      <MilestoneProgressCard
        dailyStats={[]}
        openMilestones={[makeMilestone("m1", "Alpha"), makeMilestone("m2", "Beta")]}
        selectedMilestoneId="m1"
        onSelectMilestone={onSelect}
      />,
    );
    const select = screen.getByLabelText("Milestone") as HTMLSelectElement;
    expect(select.value).toBe("m1");
    fireEvent.change(select, { target: { value: "m2" } });
    expect(onSelect).toHaveBeenCalledWith("m2");
  });

  it("omits the selector when there is a single open milestone", () => {
    render(
      <MilestoneProgressCard
        dailyStats={[]}
        openMilestones={[makeMilestone("m1", "Alpha")]}
        selectedMilestoneId={null}
        onSelectMilestone={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Milestone")).toBeNull();
    // Single-milestone title names it inline.
    expect(screen.getByText(/Milestone Progress \(Alpha\)/)).toBeInTheDocument();
  });

  it("positions bars on a true time axis (absolute, not flexed evenly)", () => {
    const stats: MilestoneDailyStats[] = [
      { milestone_id: "m1", date: "2026-04-15", completion_pct: 20 } as MilestoneDailyStats,
      { milestone_id: "m1", date: "2026-04-17", completion_pct: 40 } as MilestoneDailyStats,
      { milestone_id: "m1", date: "2026-07-06", completion_pct: 80 } as MilestoneDailyStats,
    ];
    const { container } = render(
      <MilestoneProgressCard
        dailyStats={stats}
        openMilestones={[makeMilestone("m1", "Alpha")]}
        selectedMilestoneId={null}
        onSelectMilestone={() => {}}
      />,
    );
    const bars = [...container.querySelectorAll('div[style*="position: absolute"]')] as HTMLElement[];
    expect(bars).toHaveLength(3);
    // The 2-day gap bar sits far closer to the first than to the last.
    const left = (el: HTMLElement) => parseFloat(el.style.left);
    expect(left(bars[1])).toBeLessThan(5);
    expect(left(bars[2])).toBeGreaterThan(90);
  });
});
