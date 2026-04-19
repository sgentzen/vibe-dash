import React, { useEffect } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { AppProvider, useAppDispatch } from "../../src/store";
import type { Project, Task, Agent, Milestone, Tag } from "../../src/types";

// ─── Factories ──────────────────────────────────────────────────────────

let idSeq = 0;
function uid(): string {
  return `test-${++idSeq}`;
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  const id = uid();
  return {
    id,
    name: `Project ${id}`,
    description: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const id = uid();
  return {
    id,
    project_id: "proj-1",
    parent_task_id: null,
    milestone_id: null,
    assigned_agent_id: null,
    title: `Task ${id}`,
    description: null,
    status: "planned",
    priority: "medium",
    progress: 0,
    due_date: null,
    start_date: null,
    estimate: null,
    recurrence_rule: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  const id = uid();
  return {
    id,
    name: `Agent ${id}`,
    model: null,
    capabilities: [],
    role: "agent",
    parent_agent_id: null,
    registered_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  const id = uid();
  return {
    id,
    project_id: "proj-1",
    name: `Milestone ${id}`,
    description: null,
    acceptance_criteria: "[]",
    target_date: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTag(overrides: Partial<Tag> = {}): Tag {
  const id = uid();
  return {
    id,
    project_id: "proj-1",
    name: `tag-${id}`,
    color: "#888888",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── Seed Data ──────────────────────────────────────────────────────────

export interface SeedData {
  projects?: Project[];
  tasks?: Task[];
  agents?: Agent[];
  milestones?: Milestone[];
  tags?: Tag[];
  selectedProjectId?: string | null;
  selectedMilestoneId?: string | null;
}

function Seeder({ seed, children }: { seed: SeedData; children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const [seeded, setSeeded] = React.useState(false);
  useEffect(() => {
    if (seed.projects) dispatch({ type: "SET_PROJECTS", payload: seed.projects });
    if (seed.tasks) dispatch({ type: "SET_TASKS", payload: seed.tasks });
    if (seed.agents) dispatch({ type: "SET_AGENTS", payload: seed.agents });
    if (seed.milestones) dispatch({ type: "SET_MILESTONES", payload: seed.milestones });
    if (seed.tags) dispatch({ type: "SET_TAGS", payload: seed.tags });
    if (seed.selectedProjectId !== undefined) {
      dispatch({ type: "SELECT_PROJECT", payload: seed.selectedProjectId });
    }
    if (seed.selectedMilestoneId !== undefined) {
      dispatch({ type: "SELECT_MILESTONE", payload: seed.selectedMilestoneId });
    }
    setSeeded(true);
  }, []);
  return seeded ? <>{children}</> : null;
}

// ─── Custom Render ──────────────────────────────────────────────────────

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  seed?: SeedData;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: CustomRenderOptions,
) {
  const { seed, ...renderOptions } = options ?? {};
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>
      {seed ? <Seeder seed={seed}>{children}</Seeder> : children}
    </AppProvider>
  );
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// Re-export everything from testing-library
export { screen, within, waitFor, act, fireEvent } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

// Reset ID counter between tests
export function resetIdSeq() {
  idSeq = 0;
}
