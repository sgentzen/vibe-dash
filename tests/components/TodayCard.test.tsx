// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TodayCard } from "../../src/components/dashboard/TodayCard";

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
});
