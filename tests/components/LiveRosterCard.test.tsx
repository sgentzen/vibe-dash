// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LiveRosterCard } from "../../src/components/dashboard/LiveRosterCard";
import type { Agent } from "../../src/types";

function agent(over: Partial<Agent>): Agent {
  return {
    id: "a",
    name: "coder-1",
    model: null,
    capabilities: [],
    role: "coder",
    parent_agent_id: null,
    registered_at: "2026-05-28T00:00:00Z",
    last_seen_at: new Date().toISOString(),
    health_status: "active",
    completed_today: 3,
    current_task_title: "Implementing X",
    ...over,
  } as Agent;
}

describe("LiveRosterCard", () => {
  it("renders an active agent's current task and completed-today", () => {
    render(<LiveRosterCard agents={[agent({})]} tasks={[]} />);
    expect(screen.getByText("coder-1")).toBeInTheDocument();
    expect(screen.getByText("Implementing X")).toBeInTheDocument();
    expect(screen.getByText(/3 today/)).toBeInTheDocument();
  });

  it("collapses offline agents into an expandable footer", () => {
    const agents = [
      agent({ id: "a", name: "active-1", health_status: "active" }),
      agent({ id: "b", name: "gone-1", health_status: "offline" }),
    ];
    render(<LiveRosterCard agents={agents} tasks={[]} />);
    expect(screen.queryByText("gone-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/offline/i));
    expect(screen.getByText("gone-1")).toBeInTheDocument();
  });

  it("shows an empty state when there are no agents", () => {
    render(<LiveRosterCard agents={[]} tasks={[]} />);
    expect(screen.getByText(/No agents registered/i)).toBeInTheDocument();
  });
});
