// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentDashboard } from "../../src/components/AgentDashboard";
import {
  renderWithProviders,
  screen,
  within,
  resetIdSeq,
} from "./test-utils";

// Mock useApi to avoid real fetch calls
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({
    getAgentDetail: vi.fn().mockResolvedValue({
      health_status: "active",
      completed_today: 5,
      current_task_title: "Testing task",
    }),
    getAgentActivity: vi.fn().mockResolvedValue([]),
    getAgentSessions: vi.fn().mockResolvedValue([]),
    getAgentComparison: vi.fn().mockResolvedValue({ agents: [] }),
    getTaskTypeBreakdown: vi.fn().mockResolvedValue([]),
  }),
}));

describe("AgentDashboard", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  function getDashboard() {
    // The AgentDashboard's outer div contains an h2 — get the first matching section
    const headings = screen.getAllByRole("heading", { name: "Agent Dashboard" });
    return headings[0].closest("div")!.parentElement!;
  }

  it("renders the Agent Dashboard heading", () => {
    renderWithProviders(<AgentDashboard />);
    expect(screen.getAllByRole("heading", { name: "Agent Dashboard" }).length).toBeGreaterThan(0);
  });

  it("shows status filter buttons", () => {
    renderWithProviders(<AgentDashboard />);
    const heading = screen.getAllByRole("heading", { name: "Agent Dashboard" })[0];
    const headerRow = heading.parentElement!;
    const buttons = within(headerRow).getAllByRole("button");
    const buttonTexts = buttons.map((b) => b.textContent);
    expect(buttonTexts).toContain("Active");
    expect(buttonTexts).toContain("All");
    expect(buttonTexts).toContain("Offline");
  });

  it("shows empty state when no agents registered", () => {
    renderWithProviders(<AgentDashboard />);
    expect(screen.getAllByText("No agents registered yet").length).toBeGreaterThan(0);
  });
});
