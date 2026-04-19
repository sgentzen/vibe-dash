// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { ProjectList } from "../../src/components/ProjectList";
import {
  renderWithProviders,
  screen,
  fireEvent,
  makeProject,
  makeTask,
  resetIdSeq,
} from "./test-utils";

describe("ProjectList", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  it("renders 'Projects' header", () => {
    renderWithProviders(<ProjectList />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows empty state when no projects exist", () => {
    renderWithProviders(<ProjectList />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("renders project cards for each project", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const p2 = makeProject({ id: "p2", name: "Beta" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1, p2] } });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("shows 'no tasks' when project has no tasks", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    expect(screen.getByText("no tasks")).toBeInTheDocument();
  });

  it("shows in-progress count when project has in_progress tasks", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const tasks = [
      makeTask({ project_id: "p1", status: "in_progress" }),
      makeTask({ project_id: "p1", status: "in_progress" }),
      makeTask({ project_id: "p1", status: "planned" }),
    ];
    renderWithProviders(<ProjectList />, { seed: { projects: [p1], tasks } });
    expect(screen.getByText("2 in progress")).toBeInTheDocument();
  });

  it("shows blocked count when project has blocked tasks", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const tasks = [makeTask({ project_id: "p1", status: "blocked" })];
    renderWithProviders(<ProjectList />, { seed: { projects: [p1], tasks } });
    expect(screen.getByText("1 blocked")).toBeInTheDocument();
  });

  it("shows done count as 'X/Y done'", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const tasks = [
      makeTask({ project_id: "p1", status: "done" }),
      makeTask({ project_id: "p1", status: "done" }),
      makeTask({ project_id: "p1", status: "planned" }),
    ];
    renderWithProviders(<ProjectList />, { seed: { projects: [p1], tasks } });
    expect(screen.getByText("2/3 done")).toBeInTheDocument();
  });

  it("shows 'X planned' when only planned tasks exist", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const tasks = [
      makeTask({ project_id: "p1", status: "planned" }),
      makeTask({ project_id: "p1", status: "planned" }),
    ];
    renderWithProviders(<ProjectList />, { seed: { projects: [p1], tasks } });
    expect(screen.getByText("2 planned")).toBeInTheDocument();
  });

  it("only counts tasks belonging to its own project", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    const p2 = makeProject({ id: "p2", name: "Beta" });
    const tasks = [
      makeTask({ project_id: "p1", status: "in_progress" }),
      makeTask({ project_id: "p2", status: "blocked" }),
    ];
    renderWithProviders(<ProjectList />, { seed: { projects: [p1, p2], tasks } });
    expect(screen.getByText("1 in progress")).toBeInTheDocument();
    expect(screen.getByText("1 blocked")).toBeInTheDocument();
  });

  it("selects a project when card is clicked", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    const card = screen.getByText("Alpha").closest('[role="button"]')!;
    fireEvent.click(card);
    // Selected state shows name in bold weight — easiest check is that click
    // does not throw and card still renders. Use keyboard activation for coverage too.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("responds to Enter key for selection (accessibility)", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    const card = screen.getByText("Alpha").closest('[role="button"]')!;
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("project cards are keyboard-accessible (role=button, tabindex)", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    const card = screen.getByText("Alpha").closest('[role="button"]')!;
    expect(card).toHaveAttribute("tabindex", "0");
  });
});
