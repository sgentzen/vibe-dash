// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PresetSwitcher } from "../../src/components/fleet/PresetSwitcher";
import { setReducer } from "../../src/state/setReducer";
import type { AppState } from "../../src/state/types";
import { renderWithProviders, screen, within, fireEvent, resetIdSeq } from "./test-utils";

vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({}),
}));

beforeEach(() => {
  resetIdSeq();
});

const baseState: AppState = {
  projects: [], milestones: [], tasks: [], agents: [], activity: [], blockers: [],
  tags: [], taskTagMap: {}, taskDepsMap: {}, notifications: [], unreadCount: 0,
  fileConflicts: [], worktrees: [],
  searchQuery: "", searchScope: "all",
  activeView: "fleet", fleetPreset: "overview",
  theme: "dark", alertsOpen: false,
  selectedProjectId: null, selectedMilestoneId: null,
  stats: { projects: 0, tasks: 0, activeAgents: 0, alerts: 0 },
  pollGeneration: 0, rightRailCollapsed: false,
  currentUser: null, isAuthenticated: true, authEnabled: false, teamMode: false,
  loadError: null,
};

describe("SET_FLEET_PRESET reducer", () => {
  it("updates fleetPreset", () => {
    const next = setReducer(baseState, { type: "SET_FLEET_PRESET", payload: "hotspots" });
    expect(next?.fleetPreset).toBe("hotspots");
  });

  it("leaves activeView untouched when only preset changes", () => {
    const next = setReducer(baseState, { type: "SET_FLEET_PRESET", payload: "timeline" });
    expect(next?.activeView).toBe("fleet");
    expect(next?.fleetPreset).toBe("timeline");
  });
});

describe("PresetSwitcher", () => {
  it("renders 4 preset tabs", () => {
    renderWithProviders(<PresetSwitcher active="overview" onChange={() => {}} />);
    const tablist = screen.getByRole("tablist", { name: /fleet view presets/i });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(4);
  });

  it("marks the active preset with aria-selected=true", () => {
    renderWithProviders(<PresetSwitcher active="hotspots" onChange={() => {}} />);
    const hotspotsTab = screen.getByRole("tab", { name: /hot spots preset/i });
    expect(hotspotsTab).toHaveAttribute("aria-selected", "true");
  });

  it("calls onChange with the clicked preset key", () => {
    const onChange = vi.fn();
    renderWithProviders(<PresetSwitcher active="overview" onChange={onChange} />);
    fireEvent.click(screen.getByRole("tab", { name: /agents preset/i }));
    expect(onChange).toHaveBeenCalledWith("agents");
  });
});
