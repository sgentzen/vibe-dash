// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardView } from "../../src/components/DashboardView";
import type { IngestStatus } from "../../src/hooks/useApi";
import {
  renderWithProviders,
  screen,
  waitFor,
  userEvent,
  fireEvent,
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
  getIngestStatus: vi.fn(),
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
  mockApi.getIngestStatus.mockReset().mockResolvedValue(healthyStatus());
}

/**
 * A full IngestStatus with nothing wrong. Typed against the real interface
 * rather than left as a loose object literal: the mock is a `vi.fn()`, so
 * nothing else in this file would notice the shape drifting away from what the
 * component reads (which is how `otlpSeriesCap` came to be missing here).
 */
function healthyStatus(overrides: Partial<IngestStatus> = {}): IngestStatus {
  return {
    filesTracked: 0, transcriptRows: 0, unpriced: 0, unattributed: 0,
    otlpRows: 0, otlpUnmapped: 0, otlpUnattributed: 0, mcpUnattributed: 0,
    otlpSeriesCount: 0, otlpSeriesRefused: 0, otlpSeriesCap: 10_000,
    ...overrides,
  };
}

/** A summary with enough in it that the cost cards render at all. */
const SPENT = {
  total_cost_usd: 12.5, total_input_tokens: 1000, total_output_tokens: 500, entry_count: 4,
};

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

// GET /api/ingest/status is supplementary: it feeds caveat badges and the
// dropped-data notice and nothing else. It is fetched outside the Promise.all
// that guards the cost calls for exactly one reason, and these tests are what
// hold that reason in place.
describe("DashboardView ingest status", () => {
  beforeEach(() => {
    resetIdSeq();
    resetApiDefaults();
  });

  it("still renders the cost figures when the status fetch fails", async () => {
    // The one failure mode that could blank the dashboard's cost area. The
    // figures do not come from this endpoint, so they must not depend on it.
    mockApi.getIngestStatus.mockRejectedValue(new Error("boom"));
    mockApi.getCostSummary.mockResolvedValue(SPENT);
    renderWithProviders(<DashboardView />);

    await screen.findByText(/\$12\.50/);
    expect(screen.getByText("Total Spend")).toBeTruthy();
    // No status means nothing is known to have been dropped, so nothing is said.
    expect(screen.queryByText(/ceiling|no mapper|refused/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /unattributed/ })).toBeNull();
  });

  it("says nothing about dropped data on a healthy install", async () => {
    mockApi.getCostSummary.mockResolvedValue(SPENT);
    renderWithProviders(<DashboardView />);

    await screen.findByText(/\$12\.50/);
    expect(screen.queryByText(/no mapper/i)).toBeNull();
    expect(screen.queryByText(/ceiling/i)).toBeNull();
  });

  it("renders the dropped-data notice when the status reports dropped data", async () => {
    mockApi.getIngestStatus.mockResolvedValue(healthyStatus({ otlpUnmapped: 40, otlpSeriesRefused: 5 }));
    renderWithProviders(<DashboardView />);

    await screen.findByText(/no mapper recognised/i);
    expect(screen.getByText(/40/)).toBeTruthy();
  });

  it("renders the Total Spend caveat badges from the status and the summary", async () => {
    mockApi.getCostSummary.mockResolvedValue({ ...SPENT, unpriced_entries: 3, excluded_entries: 2 });
    mockApi.getIngestStatus.mockResolvedValue(
      healthyStatus({ unattributed: 1, otlpUnattributed: 2, mcpUnattributed: 4 }),
    );
    renderWithProviders(<DashboardView />);

    // All three sources of unattributed spend, not just the two that were
    // counted before mcpUnattributed existed.
    await screen.findByRole("button", { name: "7 unattributed" });
    expect(screen.getByRole("button", { name: "3 unpriced" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2 excluded" })).toBeTruthy();
  });

  it("puts the excluded caveat in a badge, not a title attribute a mouse alone can reach", async () => {
    mockApi.getCostSummary.mockResolvedValue({ ...SPENT, excluded_entries: 2 });
    renderWithProviders(<DashboardView />);

    const badge = await screen.findByRole("button", { name: "2 excluded" });
    const explanation = document.getElementById(badge.getAttribute("aria-describedby") ?? "");
    expect(explanation?.textContent).toContain("counted from the transcripts");
    // The Total Spend card is the badge's own ancestor, so a title left on it
    // would raise a native tooltip over the badge's own over the same region.
    expect(badge.closest("[title]")).toBeNull();
  });
});

// `unattributed` counts rows with project_id IS NULL install-wide. A
// project-scoped Total Spend does not contain them and never could, so beside
// that figure the badge would qualify something it is not about.
describe("DashboardView unattributed badge scope", () => {
  beforeEach(() => {
    resetIdSeq();
    resetApiDefaults();
    mockApi.getCostSummary.mockResolvedValue(SPENT);
    mockApi.getIngestStatus.mockResolvedValue(
      healthyStatus({ unattributed: 1, otlpUnattributed: 2, mcpUnattributed: 4 }),
    );
  });

  it("shows the badge beside the global total", async () => {
    renderWithProviders(<DashboardView />);

    expect(await screen.findByRole("button", { name: "7 unattributed" })).toBeTruthy();
  });

  it("hides it beside a per-project total, on the same counts", async () => {
    const project = makeProject();
    renderWithProviders(<DashboardView />, {
      seed: { projects: [project], selectedProjectId: project.id },
    });

    // The figure itself still renders; only the caveat that is not about it goes.
    await screen.findByText(/\$12\.50/);
    expect(screen.queryByText(/unattributed/)).toBeNull();
  });
});

/**
 * The tooltip element a badge describes itself with. Followed through
 * aria-describedby rather than found by role, because the role is only present
 * while the tooltip is open and these tests need it in both states.
 */
function tipOf(badge: HTMLElement): HTMLElement {
  return document.getElementById(badge.getAttribute("aria-describedby") ?? "")!;
}

/** Laid out as a real tooltip rather than clipped off-screen. */
const isOpen = (tip: HTMLElement) => tip.style.clipPath === "";

// The Total Spend KPI is the only place in the app where caveat badges render
// side by side, so it is the only place a shared id or shared open-state
// regression can show up. CountBadge's own suite renders two in isolation;
// this one holds the real composition, where each badge is a separate element
// in a separate render position inside one KpiCard value.
describe("DashboardView adjacent caveat badges", () => {
  beforeEach(() => {
    resetIdSeq();
    resetApiDefaults();
    mockApi.getCostSummary.mockResolvedValue({ ...SPENT, unpriced_entries: 3, excluded_entries: 2 });
    mockApi.getIngestStatus.mockResolvedValue(
      healthyStatus({ unattributed: 1, otlpUnattributed: 2, mcpUnattributed: 4 }),
    );
  });

  /** Render, then hand back all three badges once the async cost load lands. */
  async function totalSpendBadges() {
    renderWithProviders(<DashboardView />);
    const unattributed = await screen.findByRole("button", { name: "7 unattributed" });
    return {
      unpriced: screen.getByRole("button", { name: "3 unpriced" }),
      unattributed,
      excluded: screen.getByRole("button", { name: "2 excluded" }),
    };
  }

  it("points each badge at its own explanation, not at a shared one", async () => {
    const { unpriced, unattributed, excluded } = await totalSpendBadges();

    const ids = [unpriced, unattributed, excluded].map((b) => b.getAttribute("aria-describedby"));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);

    // Distinct ids are not enough on their own: they could still resolve to the
    // wrong wording, which is the failure a reader would actually meet.
    expect(tipOf(unpriced).textContent).toContain("this total is a floor");
    expect(tipOf(unattributed).textContent).toContain("exceeds the sum of the per-project figures");
    expect(tipOf(excluded).textContent).toContain("counted from the transcripts");
  });

  it("opens only the badge the pointer is on, leaving its neighbours shut", async () => {
    const { unpriced, unattributed, excluded } = await totalSpendBadges();
    expect(isOpen(tipOf(unpriced))).toBe(false);

    // The pointer handlers sit on the wrapper span, not the button.
    fireEvent.mouseEnter(unpriced.parentElement!);

    expect(isOpen(tipOf(unpriced))).toBe(true);
    expect(isOpen(tipOf(unattributed))).toBe(false);
    expect(isOpen(tipOf(excluded))).toBe(false);
  });

  it("closes the first badge's tooltip when the pointer moves to the next one", async () => {
    // Two open tooltips would overlap each other in the same small region, and
    // hoisted state would show up here as both staying open or the wrong one
    // closing.
    const { unpriced, unattributed } = await totalSpendBadges();

    fireEvent.mouseEnter(unpriced.parentElement!);
    fireEvent.mouseLeave(unpriced.parentElement!);
    fireEvent.mouseEnter(unattributed.parentElement!);

    expect(isOpen(tipOf(unpriced))).toBe(false);
    expect(isOpen(tipOf(unattributed))).toBe(true);
  });
});
