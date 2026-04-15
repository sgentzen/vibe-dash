import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { AppProvider, type AppState } from "../../src/store";
import type { Project, Task, Agent, Milestone } from "../../src/types";

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
    acceptance_criteria: null,
    target_date: null,
    status: "open",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ─── Custom Render ──────────────────────────────────────────────────────

/**
 * Wraps the component in the AppProvider so useAppState / useAppDispatch work.
 * State is seeded via dispatching actions after mount.
 */
function AllProviders({ children }: { children: React.ReactNode }) {
  return <AppProvider>{children}</AppProvider>;
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything from testing-library
export { screen, within, waitFor, act, fireEvent } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";

// Reset ID counter between tests
export function resetIdSeq() {
  idSeq = 0;
}
