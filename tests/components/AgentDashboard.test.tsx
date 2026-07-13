// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentDashboard } from "../../src/components/AgentDashboard";
import {
  renderWithProviders,
  screen,
  within,
  fireEvent,
  makeAgent,
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
    getAgentPerformance: vi.fn().mockResolvedValue({
      agent_id: "a", agent_name: "Agent", tasks_completed: 7,
      total_lines_added: 1200, total_lines_removed: 300, total_files_changed: 40,
      total_tests_added: 15, avg_duration_seconds: 90, avg_lines_per_task: 171, avg_tests_per_task: 2,
    }),
    getTaskTypeBreakdown: vi.fn().mockResolvedValue([
      { priority: "high", count: 3, avg_duration_seconds: 120, avg_lines_added: 200 },
    ]),
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

  it("dashboard scroll region is keyboard-focusable and a labelled region landmark", () => {
    const { container } = renderWithProviders(<AgentDashboard />);
    const region = container.querySelector('[aria-label="Agent dashboard"]')!;
    expect(region).not.toBeNull();
    expect(region.getAttribute("tabindex")).toBe("0");
    // Native <section> with an accessible name is a region landmark (no explicit role).
    expect(region.tagName.toLowerCase()).toBe("section");
    expect(screen.getByRole("region", { name: "Agent dashboard" })).toBe(region);
  });

  it("folds per-agent Performance metrics into the agent detail view", async () => {
    const agent = makeAgent({ name: "perf-agent" });
    renderWithProviders(<AgentDashboard />, { seed: { agents: [agent] } });

    // Show all agents regardless of computed health so the card is present.
    fireEvent.click(screen.getByRole("button", { name: "All" }));

    // Open the agent detail (card has role="button").
    const nameEl = await screen.findByText("perf-agent");
    fireEvent.click(nameEl.closest('[role="button"]')!);

    // The folded-in Performance section renders from getAgentPerformance.
    expect(await screen.findByText("Performance")).toBeInTheDocument();
    expect(screen.getByText("Lines +")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });
});
