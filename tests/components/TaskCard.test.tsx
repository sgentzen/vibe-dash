// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskCard } from "../../src/components/TaskCard";
import {
  renderWithProviders,
  screen,
  makeTask,
  makeAgent,
  resetIdSeq,
} from "./test-utils";

describe("TaskCard", () => {
  const onClick = vi.fn();
  const onDragStart = vi.fn();

  beforeEach(() => {
    resetIdSeq();
    onClick.mockClear();
    onDragStart.mockClear();
  });

  it("renders task title", () => {
    const task = makeTask({ title: "Fix login bug" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
  });

  it("shows description snippet truncated to 80 chars", () => {
    const longDesc = "A".repeat(100);
    const task = makeTask({ description: longDesc });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    // Should show first 80 chars + ellipsis
    expect(screen.getByText(`${"A".repeat(80)}\u2026`)).toBeInTheDocument();
  });

  it("shows checkmark for done tasks", () => {
    const task = makeTask({ status: "done" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("\u2713")).toBeInTheDocument();
  });

  it("shows urgent priority badge", () => {
    const task = makeTask({ priority: "urgent" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("shows high priority badge", () => {
    const task = makeTask({ priority: "high" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("does not show priority badge for medium or low", () => {
    const task = makeTask({ priority: "medium" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.queryByText("medium")).not.toBeInTheDocument();
  });

  it("shows assigned agent name", () => {
    const agent = makeAgent({ id: "agent-1", name: "Claude" });
    const task = makeTask({ assigned_agent_id: "agent-1" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[agent]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("shows sub-task count when task has children", () => {
    const parent = makeTask({ id: "parent-1", title: "Parent Task" });
    const child1 = makeTask({ parent_task_id: "parent-1", status: "done" });
    const child2 = makeTask({ parent_task_id: "parent-1", status: "planned" });
    renderWithProviders(
      <TaskCard
        task={parent}
        allTasks={[parent, child1, child2]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    // Button text: "▶ 1/2 sub-tasks"
    expect(screen.getByText(/1\/2 sub-tasks/)).toBeInTheDocument();
  });

  it("shows progress bar for in_progress tasks", () => {
    const task = makeTask({ status: "in_progress", progress: 50 });
    const { container } = renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    // The progress bar is a div with width: 50%
    const progressBar = container.querySelector('div[style*="width: 50%"]');
    expect(progressBar).toBeInTheDocument();
  });

  it("shows tags when provided", () => {
    const task = makeTask();
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        taskTags={[{ id: "tag-1", project_id: "p1", name: "frontend", color: "#ff0000", created_at: "" }]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("frontend")).toBeInTheDocument();
  });

  it("shows due date when set", () => {
    const task = makeTask({ due_date: "2026-12-25" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText(/2026-12-25/)).toBeInTheDocument();
  });

  it("calls onClick when card content is clicked", async () => {
    const task = makeTask({ title: "Clickable task" });
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    screen.getByText("Clickable task").click();
    expect(onClick).toHaveBeenCalled();
  });

  it("shows blocking count badge when blockingCount > 0", () => {
    const task = makeTask();
    renderWithProviders(
      <TaskCard
        task={task}
        allTasks={[task]}
        activity={[]}
        agents={[]}
        blockingCount={3}
        onClick={onClick}
        onDragStart={onDragStart}
      />,
    );
    expect(screen.getByText("Blocked by 3")).toBeInTheDocument();
  });
});
