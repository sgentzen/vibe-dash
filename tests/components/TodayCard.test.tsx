// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayCard } from "../../src/components/dashboard/TodayCard";

/**
 * The caveat explanation is the badge's accessible description, not a `title`.
 * Read it the way a screen reader would, by following aria-describedby: the
 * element only carries role="tooltip" while it is open, so it cannot be found
 * by role from a test that never hovers.
 */
function explanationOf(badgeText: string): string {
  const badge = screen.getByRole("button", { name: badgeText });
  const id = badge.getAttribute("aria-describedby") ?? "";
  return document.getElementById(id)?.textContent ?? "";
}

describe("TodayCard", () => {
  it("renders spend, tasks done, and active count", () => {
    render(<TodayCard spendToday={2.74} tasksCompletedToday={9} activeAgents={2} />);
    expect(screen.getByText("$2.74")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/Spend/i)).toBeInTheDocument();
    expect(screen.getByText(/Tasks done/i)).toBeInTheDocument();
    expect(screen.getByText(/Active agents/i)).toBeInTheDocument();
  });

  it("shows an unpriced badge beside spend when the count is above zero", () => {
    render(
      <TodayCard spendToday={2.74} spendTodayUnpriced={3} tasksCompletedToday={9} activeAgents={2} />
    );
    expect(screen.getByText("3 unpriced")).toBeInTheDocument();
  });

  it("explains that today's figure is a floor, in this card's own wording", () => {
    // Not the Total Spend wording. That one says "this total is a floor" and
    // counts every entry ever; this badge sits beside a since-midnight figure,
    // so a helper swapped between the two call sites would say something false
    // about the number it is standing next to.
    render(
      <TodayCard spendToday={2.74} spendTodayUnpriced={3} tasksCompletedToday={9} activeAgents={2} />
    );
    const explanation = explanationOf("3 unpriced");
    expect(explanation).toContain("3 of today's entries have tokens recorded but no cost");
    expect(explanation).toContain("this figure is a floor");
  });

  it("uses the singular for one entry", () => {
    // The last of the four caveat wording helpers to get this. The other three
    // pluralise, so a lone unpriced entry read "1 of today's entries have".
    render(
      <TodayCard spendToday={2.74} spendTodayUnpriced={1} tasksCompletedToday={9} activeAgents={2} />
    );
    expect(explanationOf("1 unpriced")).toContain("entries has tokens recorded");
  });

  it("shows no unpriced badge when the count is zero", () => {
    render(
      <TodayCard spendToday={2.74} spendTodayUnpriced={0} tasksCompletedToday={9} activeAgents={2} />
    );
    expect(screen.queryByText(/unpriced/i)).toBeNull();
  });

  it("shows no unpriced badge when the prop is omitted, as an older server produces", () => {
    render(<TodayCard spendToday={2.74} tasksCompletedToday={9} activeAgents={2} />);
    expect(screen.queryByText(/unpriced/i)).toBeNull();
  });

  it("renders the rest of the card when the count is nonsense, rather than a NaN badge", () => {
    // This card has no ErrorBoundary above it. The guard lives in CountBadge,
    // but only this call site proves that a bad count costs one badge and not
    // the three figures beside it.
    render(
      <TodayCard
        spendToday={2.74}
        spendTodayUnpriced={Number.NaN}
        tasksCompletedToday={9}
        activeAgents={2}
      />
    );
    expect(screen.queryByText(/unpriced/i)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByText("$2.74")).toBeInTheDocument();
  });
});
