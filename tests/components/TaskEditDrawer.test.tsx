// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskEditDrawer } from "../../src/components/TaskEditDrawer";
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  makeTask,
  makeMilestone,
  makeAgent,
  resetIdSeq,
} from "./test-utils";

const updateTask = vi.fn();
const completeTask = vi.fn();
const addComment = vi.fn();
const getComments = vi.fn();

const stableApi = { updateTask, completeTask, addComment, getComments };
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => stableApi,
}));

// focus-trap-react throws in jsdom because layout/tabbable detection
// relies on getBoundingClientRect returning real values. Render children
// without trapping focus — behavior we care about is the form, not focus.
vi.mock("focus-trap-react", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
  FocusTrap: ({ children }: { children: React.ReactNode }) => children,
}));

import type React from "react";

describe("TaskEditDrawer", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    resetIdSeq();
    onClose.mockClear();
    updateTask.mockReset().mockResolvedValue({ ...makeTask(), title: "Updated" });
    completeTask.mockReset().mockResolvedValue({ ...makeTask(), status: "done" });
    addComment.mockReset().mockResolvedValue({
      id: "c1", task_id: "t1", author_name: "User",
      message: "hi", created_at: new Date().toISOString(),
    });
    getComments.mockReset().mockResolvedValue([]);
  });

  it("renders Edit Task heading and form fields", async () => {
    const task = makeTask({ id: "t1", title: "My Task" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    expect(screen.getByText("Edit Task")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("My Task");
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toBeInTheDocument();
  });

  it("pre-populates fields from the task prop", () => {
    const task = makeTask({
      id: "t1",
      title: "Initial Title",
      description: "Initial description",
      priority: "high",
      status: "in_progress",
      progress: 42,
    });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    expect(screen.getByLabelText("Title")).toHaveValue("Initial Title");
    expect(screen.getByLabelText("Description")).toHaveValue("Initial description");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByLabelText("Status")).toHaveValue("in_progress");
  });

  it("updates title state when user types", () => {
    const task = makeTask({ id: "t1", title: "Old" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    const titleInput = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "New Title" } });
    expect(titleInput.value).toBe("New Title");
  });

  it("calls updateTask with edited fields when Save is clicked", async () => {
    const task = makeTask({ id: "t1", title: "Old" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New Title" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "urgent" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledTimes(1);
    });
    const [id, patch] = updateTask.mock.calls[0];
    expect(id).toBe("t1");
    expect(patch.title).toBe("New Title");
    expect(patch.priority).toBe("urgent");
  });

  it("closes the drawer after a successful save", async () => {
    const task = makeTask({ id: "t1", title: "Old" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows Mark Done button for non-done tasks", () => {
    const task = makeTask({ status: "in_progress" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    expect(screen.getByText("Mark Done")).toBeInTheDocument();
  });

  it("hides Mark Done button for already-done tasks", () => {
    const task = makeTask({ status: "done" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    expect(screen.queryByText("Mark Done")).not.toBeInTheDocument();
  });

  it("calls completeTask when Mark Done is clicked", async () => {
    const task = makeTask({ id: "t1", status: "in_progress" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    fireEvent.click(screen.getByText("Mark Done"));
    await waitFor(() => {
      expect(completeTask).toHaveBeenCalledWith("t1");
    });
  });

  it("calls onClose when × button is clicked", () => {
    const task = makeTask();
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows milestone dropdown when project has milestones", () => {
    const task = makeTask({ project_id: "p1" });
    const milestone = makeMilestone({ id: "m1", project_id: "p1", name: "Sprint 1" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />, {
      seed: { milestones: [milestone] },
    });
    expect(screen.getByLabelText("Milestone")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1")).toBeInTheDocument();
  });

  it("hides milestone dropdown when project has no milestones", () => {
    const task = makeTask({ project_id: "p1" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    expect(screen.queryByLabelText("Milestone")).not.toBeInTheDocument();
  });

  it("shows agent dropdown when agents exist", () => {
    const task = makeTask();
    const agent = makeAgent({ id: "a1", name: "Claude" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />, {
      seed: { agents: [agent] },
    });
    expect(screen.getByLabelText("Assigned Agent")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });

  it("disables comment Send button when input is empty", () => {
    const task = makeTask();
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    const sendBtn = screen.getByText("Send") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it("calls addComment when comment is submitted", async () => {
    const task = makeTask({ id: "t1" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    const commentInput = screen.getByLabelText("Add a comment");
    fireEvent.change(commentInput, { target: { value: "Looks good" } });
    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => {
      expect(addComment).toHaveBeenCalledWith("t1", "Looks good", "User");
    });
  });

  it("loads existing comments on mount", async () => {
    const task = makeTask({ id: "t1" });
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    await waitFor(() => {
      expect(getComments).toHaveBeenCalledWith("t1");
    });
  });

  it("drawer has correct ARIA attributes for modal dialog", () => {
    const task = makeTask();
    renderWithProviders(<TaskEditDrawer task={task} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Edit task");
  });
});
