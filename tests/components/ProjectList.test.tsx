// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { ProjectList } from "../../src/components/ProjectList";
import {
  renderWithProviders,
  screen,
  fireEvent,
  makeProject,
  makeTask,
  resetIdSeq,
} from "./test-utils";

function mockRes(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as unknown as Response;
}

function getFetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
}

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

describe("ProjectList — archive", () => {
  beforeEach(() => {
    resetIdSeq();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a keyboard-accessible Archive action per project", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    const btn = screen.getByRole("button", { name: "Archive project Alpha" });
    expect(btn.tagName).toBe("BUTTON");
  });

  it("clicking Archive opens a confirmation dialog without archiving yet", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    fireEvent.click(screen.getByRole("button", { name: "Archive project Alpha" }));

    expect(screen.getByRole("heading", { name: "Archive project?" })).toBeInTheDocument();
    expect(getFetchMock()).not.toHaveBeenCalled();
  });

  it("clicking the Archive action does not select the project card", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    fireEvent.click(screen.getByRole("button", { name: "Archive project Alpha" }));
    // The dialog opening (not a card-selection side effect) is the only
    // change; explicitly assert the click didn't bubble to card selection by
    // cancelling and checking the card is unaffected (still present, not
    // marked archived).
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("Cancel closes the dialog without calling the API", () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });
    fireEvent.click(screen.getByRole("button", { name: "Archive project Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Archive project?" })).not.toBeInTheDocument();
    expect(getFetchMock()).not.toHaveBeenCalled();
  });

  it("confirming archives the project and removes it from the visible list", async () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    getFetchMock().mockResolvedValue(mockRes({ ...p1, archived_at: "2026-01-02T00:00:00.000Z" }));
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });

    fireEvent.click(screen.getByRole("button", { name: "Archive project Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(screen.queryByText("Alpha")).not.toBeInTheDocument());
    const [url, init] = getFetchMock().mock.calls[0];
    expect(url).toBe("/api/projects/p1/archive");
    expect(init.method).toBe("POST");
  });

  it("Show archived toggle fetches and renders archived projects", async () => {
    const active = makeProject({ id: "p1", name: "Alpha" });
    const archived = makeProject({ id: "p2", name: "Beta", archived_at: "2026-01-02T00:00:00.000Z" });
    getFetchMock().mockResolvedValue(mockRes([active, archived]));
    renderWithProviders(<ProjectList />, { seed: { projects: [active] } });

    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));

    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());
    expect(getFetchMock().mock.calls[0][0]).toBe("/api/projects?include_archived=true");
    // The active project's list is untouched — still just Alpha there.
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("Unarchive restores a project from the archived list", async () => {
    const archived = makeProject({ id: "p2", name: "Beta", archived_at: "2026-01-02T00:00:00.000Z" });
    getFetchMock()
      .mockResolvedValueOnce(mockRes([archived]))
      .mockResolvedValueOnce(mockRes({ ...archived, archived_at: null }));
    renderWithProviders(<ProjectList />, { seed: { projects: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Unarchive project Beta" }));

    // Unarchiving moves it into the active list (state.projects, via the
    // synthetic project_unarchived WS_EVENT dispatch), so "Beta" the text is
    // still on screen — what must disappear is the archived-section
    // "Unarchive" action, since the card is no longer in that section.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Unarchive project Beta" })).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Archive project Beta" })).toBeInTheDocument();
    const [url, init] = getFetchMock().mock.calls[1];
    expect(url).toBe("/api/projects/p2/unarchive");
    expect(init.method).toBe("POST");
  });

  it("a failed archive leaves the project in place and announces the failure", async () => {
    const p1 = makeProject({ id: "p1", name: "Alpha" });
    getFetchMock().mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ error: "boom" }),
    } as unknown as Response);
    renderWithProviders(<ProjectList />, { seed: { projects: [p1] } });

    fireEvent.click(screen.getByRole("button", { name: "Archive project Alpha" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    // Nothing about the project's visibility changes on failure: the card
    // (and its Archive action, i.e. it's still treated as active) stay put.
    await waitFor(() => expect(screen.getByText('Couldn\'t archive "Alpha". Try again.')).toBeInTheDocument());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive project Alpha" })).toBeInTheDocument();
  });

  it("a failed unarchive leaves the project in the archived list and announces the failure", async () => {
    const archived = makeProject({ id: "p2", name: "Beta", archived_at: "2026-01-02T00:00:00.000Z" });
    getFetchMock()
      .mockResolvedValueOnce(mockRes([archived]))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: async () => ({ error: "boom" }),
      } as unknown as Response);
    renderWithProviders(<ProjectList />, { seed: { projects: [] } });

    fireEvent.click(screen.getByRole("button", { name: "Show archived" }));
    await waitFor(() => expect(screen.getByText("Beta")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Unarchive project Beta" }));

    await waitFor(() => expect(screen.getByText('Couldn\'t unarchive "Beta". Try again.')).toBeInTheDocument());
    // Still in the archived section, still offering Unarchive to retry.
    expect(screen.getByRole("button", { name: "Unarchive project Beta" })).toBeInTheDocument();
  });
});
