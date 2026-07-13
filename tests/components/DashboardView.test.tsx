// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardView } from "../../src/components/DashboardView";
import { renderWithProviders, waitFor, resetIdSeq } from "./test-utils";

// Empty responses so the dashboard renders its no-data state (no chart SVGs).
// The object must be STABLE across renders — the real useApi is useMemo-stable,
// and DashboardView lists `api` in effect deps, so a fresh object per render
// would re-fire the effects → setState → infinite render loop. Building it once
// inside the (hoisted) factory keeps the reference identical across calls.
vi.mock("../../src/hooks/useApi", () => {
  const api = {
    getMilestoneDailyStats: vi.fn().mockResolvedValue([]),
    getCostSummary: vi.fn().mockResolvedValue({
      total_cost_usd: 0, total_input_tokens: 0, total_output_tokens: 0, entry_count: 0,
    }),
    getCostTimeseries: vi.fn().mockResolvedValue([]),
    getCostByModel: vi.fn().mockResolvedValue([]),
    getCostByAgent: vi.fn().mockResolvedValue([]),
    getAgentComparison: vi.fn().mockResolvedValue(null),
  };
  return { useApi: () => api };
});

describe("DashboardView", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  it("KPI cards render no sparkline SVG (honest-absence over decorative trend)", async () => {
    const { container } = renderWithProviders(<DashboardView />);
    // Let the async chart/cost effects settle.
    await waitFor(() => {
      // Sparkline was the only inline <svg> the KPI row emitted.
      expect(container.querySelectorAll("svg").length).toBe(0);
    });
  });
});
