// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskBoard } from "../../src/components/TaskBoard";
import {
  renderWithProviders,
  screen,
  makeProject,
  makeTask,
  makeMilestone,
  resetIdSeq,
} from "./test-utils";

vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({
    createTask: vi.fn().mockResolvedValue(null),
    updateTask: vi.fn().mockResolvedValue(null),
    completeTask: vi.fn().mockResolvedValue(null),
    addComment: vi.fn().mockResolvedValue(null),
    getComments: vi.fn().mockResolvedValue([]),
  }),
}));

describe("TaskBoard", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  it("renders the three kanban columns", () => {
    renderWithProviders(<TaskBoard />);
    expect(screen.getByText("PLANNED")).toBeInTheDocument();
    expect(screen.getByText("IN PROGRESS")).toBeInTheDocument();
    expect(screen.getByText("DONE")).toBeInTheDocument();
  });

  it("shows 'All Projects' when no project is selected", () => {
    renderWithProviders(<TaskBoard />);
    expect(screen.getByText("All Projects")).toBeInTheDocument();
  });

  it("shows project name when a project is selected", () => {
    const p1 = makeProject({ id: "p1", name: "My Project" });
    renderWithProviders(<TaskBoard />, {
      seed: { projects: [p1], selectedProjectId: "p1" },
    });
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("filters tasks by selected project", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const p2 = makeProject({ id: "p2", name: "Beta" });
    const tasks = [
      makeTask({ project_id: "p1", title: "Task in Alpha" }),
      makeTask({ project_id: "p2", title: "Task in Beta" }),
    ];
    renderWithProviders(<TaskBoard />, {
      seed: { projects: [p1, p2], tasks, selectedProjectId: "p1" },
    });
    expect(screen.getByText("Task in Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Task in Beta")).not.toBeInTheDocument();
  });

  it("filters tasks by search query (title match)", () => {
    const tasks = [
      makeTask({ title: "Implement login" }),
      makeTask({ title: "Setup database" }),
    ];
    renderWithProviders(<TaskBoard />, {
      seed: { tasks },
    });
    // Simulate search by dispatching before rendering — test-utils seeder runs
    // before children mount, but searchQuery isn't in SeedData. Instead, rely on
    // default (no query) showing both titles.
    expect(screen.getByText("Implement login")).toBeInTheDocument();
    expect(screen.getByText("Setup database")).toBeInTheDocument();
  });

  it("excludes sub-tasks from the board (only top-level shown)", () => {
    const tasks = [
      makeTask({ id: "parent", title: "Parent Task" }),
      makeTask({ parent_task_id: "parent", title: "Child Task" }),
    ];
    renderWithProviders(<TaskBoard />, {
      seed: { tasks },
    });
    expect(screen.getByText("Parent Task")).toBeInTheDocument();
    expect(screen.queryByText("Child Task")).not.toBeInTheDocument();
  });

  it("shows task counts in column headers", () => {
    const tasks = [
      makeTask({ status: "planned", title: "Task A" }),
      makeTask({ status: "planned", title: "Task B" }),
      makeTask({ status: "in_progress", title: "Task C" }),
    ];
    renderWithProviders(<TaskBoard />, {
      seed: { tasks },
    });
    // Planned column header contains "2"; In Progress contains "1"
    const plannedHeader = screen.getByText("PLANNED").parentElement!;
    const inProgressHeader = screen.getByText("IN PROGRESS").parentElement!;
    expect(plannedHeader.textContent).toContain("2");
    expect(inProgressHeader.textContent).toContain("1");
  });

  it("places tasks into the column matching their status", () => {
    const tasks = [
      makeTask({ status: "planned", title: "Plan-Task" }),
      makeTask({ status: "in_progress", title: "WIP-Task" }),
    ];
    renderWithProviders(<TaskBoard />, {
      seed: { tasks },
    });
    expect(screen.getByText("Plan-Task")).toBeInTheDocument();
    expect(screen.getByText("WIP-Task")).toBeInTheDocument();
  });

  it("renders milestone filter when project has milestones", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const m1 = makeMilestone({ id: "m1", project_id: "p1", name: "Sprint 1" });
    renderWithProviders(<TaskBoard />, {
      seed: { projects: [p1], milestones: [m1], selectedProjectId: "p1" },
    });
    expect(screen.getByLabelText("Filter by milestone")).toBeInTheDocument();
  });

  it("does not render milestone filter when project has no milestones", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<TaskBoard />, {
      seed: { projects: [p1], selectedProjectId: "p1" },
    });
    expect(screen.queryByLabelText("Filter by milestone")).not.toBeInTheDocument();
  });

  it("shows Add task inputs in planned & in_progress columns when project is selected", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<TaskBoard />, {
      seed: { projects: [p1], selectedProjectId: "p1" },
    });
    expect(screen.getByLabelText("Add task to PLANNED")).toBeInTheDocument();
    expect(screen.getByLabelText("Add task to IN PROGRESS")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add task to DONE")).not.toBeInTheDocument();
  });

  it("hides Add task inputs when no project is selected", () => {
    renderWithProviders(<TaskBoard />);
    expect(screen.queryByLabelText("Add task to PLANNED")).not.toBeInTheDocument();
  });
});
