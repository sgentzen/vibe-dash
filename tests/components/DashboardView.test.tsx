// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardView } from "../../src/components/DashboardView";
import {
  renderWithProviders,
  screen,
  waitFor,
  userEvent,
  resetIdSeq,
  makeProject,
  makeMilestone,
} from "./test-utils";

// A single, reference-stable api mock. The real useApi is useMemo-stable and
// DashboardView lists `api` in effect deps, so a fresh object per render would
// re-fire effects → setState → infinite render loop. vi.hoisted builds it once;
// `useApi: () => mockApi` returns the identical reference on every render.
const mockApi = vi.hoisted(() => ({
  getMilestoneDailyStats: vi.fn(),
  getCostSummary: vi.fn(),
  getCostTimeseries: vi.fn(),
  getCostByModel: vi.fn(),
  getCostByAgent: vi.fn(),
  getAgentComparison: vi.fn(),
}));

vi.mock("../../src/hooks/useApi", () => ({ useApi: () => mockApi }));

// Default happy-path responses: empty everywhere so the dashboard renders its
// no-data states (no chart SVGs, no cost cards, no agent card).
function resetApiDefaults() {
  mockApi.getMilestoneDailyStats.mockReset().mockResolvedValue([]);
  mockApi.getCostSummary.mockReset().mockResolvedValue({
    total_cost_usd: 0, total_input_tokens: 0, total_output_tokens: 0, entry_count: 0,
  });
  mockApi.getCostTimeseries.mockReset().mockResolvedValue([]);
  mockApi.getCostByModel.mockReset().mockResolvedValue([]);
  mockApi.getCostByAgent.mockReset().mockResolvedValue([]);
  mockApi.getAgentComparison.mockReset().mockResolvedValue(null);
}

describe("DashboardView", () => {
  beforeEach(() => {
    resetIdSeq();
    resetApiDefaults();
  });

  it("KPI cards render no sparkline SVG (honest-absence over decorative trend)", async () => {
    const { container } = renderWithProviders(<DashboardView />);
    // Let the async chart/cost effects settle.
    await waitFor(() => {
      // Sparkline was the only inline <svg> the KPI row emitted.
      expect(container.querySelectorAll("svg")).toHaveLength(0);
    });
  });

  it("shows an inline error + Retry when cost data fails to load, and recovers on retry", async () => {
    // One of the four parallel cost calls rejecting fails the whole Promise.all.
    mockApi.getCostSummary.mockRejectedValueOnce(new Error("boom"));
    const user = userEvent.setup();
    renderWithProviders(<DashboardView />);

    await screen.findByText(/Couldn't load cost data/i);
    const retry = screen.getByRole("button", { name: "Retry" });

    // Retry now hits the default (resolved) mock → error clears, no-data state returns.
    await user.click(retry);
    await waitFor(() => {
      expect(screen.queryByText(/Couldn't load cost data/i)).toBeNull();
    });
    await screen.findByText(/No cost data recorded yet/i);
  });

  it("shows an inline error + Retry when the milestone chart fails to load (no silent blank)", async () => {
    const project = makeProject();
    const milestone = makeMilestone({ project_id: project.id, status: "open" });
    mockApi.getMilestoneDailyStats.mockRejectedValueOnce(new Error("boom"));

    renderWithProviders(<DashboardView />, {
      seed: { projects: [project], milestones: [milestone], selectedProjectId: project.id },
    });

    await screen.findByText(/Couldn't load milestone progress/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows an inline error + Retry when agent efficiency fails to load, and recovers on retry", async () => {
    mockApi.getAgentComparison.mockRejectedValueOnce(new Error("boom"));
    // After the first (rejected) call, retry resolves with real agent data.
    mockApi.getAgentComparison.mockResolvedValue({
      agents: [
        { agent_id: "a1", agent_name: "Ada", tasks_completed: 3, avg_duration_seconds: 120, avg_lines_per_task: 40 },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<DashboardView />);

    await screen.findByText(/Couldn't load agent efficiency/i);
    await user.click(screen.getByRole("button", { name: "Retry" }));

    // "Ada" only renders in the real AgentEfficiencyCard — the CardError shares
    // the "Agent Efficiency" title, so assert on the agent row to prove recovery.
    await screen.findByText("Ada");
    await waitFor(() => {
      expect(screen.queryByText(/Couldn't load agent efficiency/i)).toBeNull();
    });
  });
});
