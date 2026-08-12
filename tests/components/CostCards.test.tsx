// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CostByAgentCard, CostByModelCard } from "../../src/components/dashboard/CostCards";

interface AgentRow {
  agent_id: string;
  agent_name: string;
  total_cost_usd: number | null;
  total_tokens: number;
  excluded_entries?: number | null;
  unpriced_entries?: number | null;
}

interface ModelRow {
  model: string;
  provider: string;
  total_cost_usd: number | null;
  total_tokens: number;
  unpriced_entries?: number | null;
}

function row(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    agent_id: "a1",
    agent_name: "claude-code-a1b2c3d4",
    total_cost_usd: 12.5,
    total_tokens: 1000,
    ...overrides,
  };
}

function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    model: "claude-opus-5",
    provider: "anthropic",
    total_cost_usd: 12.5,
    total_tokens: 1000,
    ...overrides,
  };
}

describe("CostByAgentCard excluded entries", () => {
  it("says nothing when no rows were excluded", () => {
    render(<CostByAgentCard data={[row({ excluded_entries: 0 })]} />);

    expect(screen.getByText(/\$12\.5000/)).toBeTruthy();
    expect(screen.queryByText(/excluded/)).toBeNull();
  });

  it("marks an agent whose only spend was suppressed, so $0.00 does not read as free", () => {
    // The case this exists for. Transcript rows carry no agent_id, so once the
    // client is marked this agent's total drops to zero and it would otherwise
    // be indistinguishable from an agent that never did anything.
    render(<CostByAgentCard data={[row({ total_cost_usd: 0, excluded_entries: 7 })]} />);

    // Wording was unified to "N excluded" (dropping the "+") so CountBadge can
    // serve every caveat on these cards, not just this one.
    expect(screen.getByText("7 excluded")).toBeTruthy();
  });

  it("explains in the tooltip that the spend is counted from transcripts, not lost", () => {
    render(<CostByAgentCard data={[row({ total_cost_usd: 0, excluded_entries: 7 })]} />);

    const badge = screen.getByText("7 excluded");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("counted from the transcripts");
    expect(title).toContain("not missing");
  });

  it("uses the singular for one entry", () => {
    render(<CostByAgentCard data={[row({ excluded_entries: 1 })]} />);

    const title = screen.getByText("1 excluded").getAttribute("title") ?? "";
    expect(title).toContain("1 self-reported entry excluded");
    expect(title).not.toContain("entries");
  });

  it("still renders when the field is absent, as an older server would send", () => {
    // The component must degrade rather than blank the dashboard: these cards
    // render in a tree with no ErrorBoundary.
    render(<CostByAgentCard data={[row()]} />);

    expect(screen.getByText(/\$12\.5000/)).toBeTruthy();
    expect(screen.queryByText(/excluded/)).toBeNull();
  });

  it("ignores a nonsense value rather than rendering it", () => {
    render(<CostByAgentCard data={[row({ excluded_entries: Number.NaN })]} />);

    expect(screen.queryByText(/excluded/)).toBeNull();
  });

  it("keeps the token count alongside the badge", () => {
    render(<CostByAgentCard data={[row({ total_cost_usd: 0, excluded_entries: 2 })]} />);

    expect(screen.getByText("2 excluded")).toBeTruthy();
    expect(screen.getByText(/tok/)).toBeTruthy();
  });
});

describe("CostByAgentCard unpriced entries", () => {
  it("shows an unpriced badge when the agent has entries with no cost", () => {
    render(<CostByAgentCard data={[row({ unpriced_entries: 3 })]} />);

    const badge = screen.getByText("3 unpriced");
    expect(badge).toBeTruthy();
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("floor");
  });

  it("says nothing when nothing is unpriced", () => {
    render(<CostByAgentCard data={[row({ unpriced_entries: 0 })]} />);

    expect(screen.queryByText(/unpriced/)).toBeNull();
  });

  it("says nothing when the field is absent, as an older server would send", () => {
    render(<CostByAgentCard data={[row()]} />);

    expect(screen.queryByText(/unpriced/)).toBeNull();
  });

  it("can show both the excluded and unpriced badges on the same row", () => {
    render(<CostByAgentCard data={[row({ excluded_entries: 1, unpriced_entries: 4 })]} />);

    expect(screen.getByText("1 excluded")).toBeTruthy();
    expect(screen.getByText("4 unpriced")).toBeTruthy();
  });
});

describe("CostByModelCard unpriced entries", () => {
  it("shows an unpriced badge when the model has entries with no cost", () => {
    render(<CostByModelCard data={[modelRow({ unpriced_entries: 5 })]} />);

    const badge = screen.getByText("5 unpriced");
    expect(badge).toBeTruthy();
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("floor");
  });

  it("says nothing when nothing is unpriced", () => {
    render(<CostByModelCard data={[modelRow({ unpriced_entries: 0 })]} />);

    expect(screen.queryByText(/unpriced/)).toBeNull();
  });

  it("says nothing when the field is absent, as an older server would send", () => {
    render(<CostByModelCard data={[modelRow()]} />);

    expect(screen.queryByText(/unpriced/)).toBeNull();
  });

  it("still shows the badge when the model's cost itself is missing", () => {
    // Mirrors the excluded-badge case on CostByAgentCard: a bad or absent
    // total must not suppress the caveat that explains it, since these cards
    // degrade to "n/a" rather than trusting a null total.
    render(<CostByModelCard data={[modelRow({ total_cost_usd: null, unpriced_entries: 5 })]} />);

    expect(screen.getByText(/n\/a/)).toBeTruthy();
    expect(screen.getByText("5 unpriced")).toBeTruthy();
  });
});
