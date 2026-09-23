import { describe, it, expect } from "vitest";
import { wsReducer } from "../../src/state/wsReducer";
import type { AppState } from "../../src/state/types";
import type { Project } from "../../src/types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "P1",
    description: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    archived_at: null,
    ...overrides,
  };
}

const baseState: AppState = {
  projects: [],
  milestones: [],
  tasks: [],
  agents: [],
  activity: [],
  blockers: [],
  taskDepsMap: {},
  searchQuery: "",
  searchScope: "all",
  activeView: "fleet",
  fleetPreset: "overview",
  theme: "dark",
  selectedProjectId: null,
  selectedMilestoneId: null,
  stats: {
    projects: 0,
    tasks: 0,
    activeAgents: 0,
    alerts: 0,
    spend_today: 0,
    spend_today_unpriced: 0,
    tasks_completed_today: 0,
  },
  pollGeneration: 0,
  rightRailCollapsed: false,
  loadError: null,
};

describe("wsReducer — project_archived", () => {
  it("removes the project from state.projects and decrements the stat", () => {
    const project = makeProject();
    const state: AppState = {
      ...baseState,
      projects: [project],
      stats: { ...baseState.stats, projects: 1 },
    };

    const next = wsReducer(state, { type: "project_archived", payload: { ...project, archived_at: "2026-01-02T00:00:00.000Z" } });

    expect(next.projects).toEqual([]);
    expect(next.stats.projects).toBe(0);
  });

  it("clears selectedProjectId when the archived project was selected", () => {
    const project = makeProject();
    const state: AppState = {
      ...baseState,
      projects: [project],
      selectedProjectId: project.id,
      stats: { ...baseState.stats, projects: 1 },
    };

    const next = wsReducer(state, { type: "project_archived", payload: { ...project, archived_at: "2026-01-02T00:00:00.000Z" } });

    expect(next.selectedProjectId).toBeNull();
  });

  it("leaves selectedProjectId alone when a different project was selected", () => {
    const project = makeProject({ id: "p1" });
    const other = makeProject({ id: "p2" });
    const state: AppState = {
      ...baseState,
      projects: [project, other],
      selectedProjectId: other.id,
      stats: { ...baseState.stats, projects: 2 },
    };

    const next = wsReducer(state, { type: "project_archived", payload: { ...project, archived_at: "2026-01-02T00:00:00.000Z" } });

    expect(next.selectedProjectId).toBe(other.id);
  });

  it("is idempotent — archiving a project already absent from state leaves stats untouched", () => {
    const project = makeProject();
    const state: AppState = { ...baseState, projects: [], stats: { ...baseState.stats, projects: 0 } };

    const next = wsReducer(state, { type: "project_archived", payload: { ...project, archived_at: "2026-01-02T00:00:00.000Z" } });

    expect(next).toBe(state);
  });

  it("never decrements the stat below zero", () => {
    const project = makeProject();
    const state: AppState = {
      ...baseState,
      projects: [project],
      stats: { ...baseState.stats, projects: 0 },
    };

    const next = wsReducer(state, { type: "project_archived", payload: { ...project, archived_at: "2026-01-02T00:00:00.000Z" } });

    expect(next.stats.projects).toBe(0);
  });
});

describe("wsReducer — project_unarchived", () => {
  it("adds the project back to state.projects and increments the stat", () => {
    const project = makeProject({ archived_at: null });
    const state: AppState = { ...baseState, projects: [], stats: { ...baseState.stats, projects: 0 } };

    const next = wsReducer(state, { type: "project_unarchived", payload: project });

    expect(next.projects).toEqual([project]);
    expect(next.stats.projects).toBe(1);
  });

  it("is idempotent — unarchiving a project already present leaves state untouched", () => {
    const project = makeProject();
    const state: AppState = {
      ...baseState,
      projects: [project],
      stats: { ...baseState.stats, projects: 1 },
    };

    const next = wsReducer(state, { type: "project_unarchived", payload: project });

    expect(next).toBe(state);
  });
});
