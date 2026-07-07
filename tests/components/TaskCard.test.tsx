// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskCard } from "../../src/components/TaskCard";
import {
  renderWithProviders,
  screen,
  within,
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

describe("TaskCard agent badge", () => {
  const onClick = vi.fn();
  const onDragStart = vi.fn();

  beforeEach(() => {
    resetIdSeq();
    onClick.mockClear();
    onDragStart.mockClear();
  });

  it("renders the assigned agent with a freshness dot (active=green)", () => {
    const agent = makeAgent({ id: "a1", name: "claude-coder", health_status: "active" });
    const task = makeTask({ assigned_agent_id: "a1" });
    renderWithProviders(
      <TaskCard task={task} allTasks={[task]} activity={[]} agents={[agent]}
        onClick={onClick} onDragStart={onDragStart} />,
    );
    const badge = screen.getByTestId("agent-badge");
    expect(badge).toHaveTextContent("claude-coder");
    const dot = within(badge).getByTestId("agent-fresh-dot");
    expect(dot.style.background).toBe("var(--status-success)");
  });

  it("renders no agent badge when unassigned", () => {
    const task = makeTask({ assigned_agent_id: null });
    renderWithProviders(
      <TaskCard task={task} allTasks={[task]} activity={[]} agents={[]}
        onClick={onClick} onDragStart={onDragStart} />,
    );
    expect(screen.queryByTestId("agent-badge")).not.toBeInTheDocument();
  });

  it("places the agent badge before the priority badge", () => {
    const agent = makeAgent({ id: "a1", name: "claude-coder" });
    const task = makeTask({ assigned_agent_id: "a1", priority: "high" });
    renderWithProviders(
      <TaskCard task={task} allTasks={[task]} activity={[]} agents={[agent]}
        onClick={onClick} onDragStart={onDragStart} />,
    );
    const badge = screen.getByTestId("agent-badge");
    const pri = screen.getByText("high");
    expect(badge.compareDocumentPosition(pri) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("TaskCard just-changed pulse (status)", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("adds highlight-pulse when status changes between renders, not on first render", () => {
    const t = makeTask({ id: "pulse-task-1", status: "planned" });
    const agents = [makeAgent({})];
    const view = renderWithProviders(
      <TaskCard task={t} allTasks={[t]} activity={[]} agents={agents} onClick={() => {}} onDragStart={() => {}} />
    );
    const card = view.container.firstElementChild as HTMLElement;
    expect(card.className).not.toContain("highlight-pulse");
    const t2 = makeTask({ id: "pulse-task-1", status: "in_progress" });
    view.rerender(
      <TaskCard task={t2} allTasks={[t2]} activity={[]} agents={agents} onClick={() => {}} onDragStart={() => {}} />
    );
    expect((view.container.firstElementChild as HTMLElement).className).toContain("highlight-pulse");
  });
});

describe("TaskCard justAppeared pulse", () => {
  it("adds highlight-pulse when justAppeared is true", () => {
    const t = makeTask({ id: "appear-1" });
    const view = renderWithProviders(
      <TaskCard task={t} allTasks={[t]} activity={[]} agents={[makeAgent({})]} justAppeared onClick={() => {}} onDragStart={() => {}} />
    );
    expect((view.container.firstElementChild as HTMLElement).className).toContain("highlight-pulse");
  });

  it("does NOT add highlight-pulse for a new card when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    const t = makeTask({ id: "appear-rm" });
    const view = renderWithProviders(
      <TaskCard task={t} allTasks={[t]} activity={[]} agents={[makeAgent({})]} justAppeared onClick={() => {}} onDragStart={() => {}} />
    );
    expect((view.container.firstElementChild as HTMLElement).className).not.toContain("highlight-pulse");
    vi.unstubAllGlobals();
  });
});
