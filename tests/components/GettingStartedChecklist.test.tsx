// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { GettingStartedChecklist } from "../../src/components/GettingStartedChecklist";
import {
  renderWithProviders,
  screen,
  fireEvent,
  makeProject,
  makeTask,
  makeAgent,
  makeMilestone,
  resetIdSeq,
} from "./test-utils";

beforeEach(() => {
  resetIdSeq();
  localStorage.clear();
});

describe("GettingStartedChecklist", () => {
  it("renders nothing before the first project exists", () => {
    renderWithProviders(<GettingStartedChecklist />);
    expect(screen.queryByText(/Getting started/)).not.toBeInTheDocument();
  });

  it("shows the remaining next steps once a project exists", async () => {
    renderWithProviders(<GettingStartedChecklist />, { seed: { projects: [makeProject()] } });
    expect(await screen.findByText(/Getting started/)).toBeInTheDocument();
    expect(screen.getByText("Create a task")).toBeInTheDocument();
    expect(screen.getByText("Connect an agent")).toBeInTheDocument();
    expect(screen.getByText("Add a milestone")).toBeInTheDocument();
  });

  it("hides once every step is complete", async () => {
    renderWithProviders(<GettingStartedChecklist />, {
      seed: {
        projects: [makeProject()],
        tasks: [makeTask()],
        agents: [makeAgent()],
        milestones: [makeMilestone()],
      },
    });
    // Give the seeder's effect a tick to run, then assert it stays hidden.
    await Promise.resolve();
    expect(screen.queryByText(/Getting started/)).not.toBeInTheDocument();
  });

  it("dismisses and persists the dismissal", async () => {
    renderWithProviders(<GettingStartedChecklist />, { seed: { projects: [makeProject()] } });
    const btn = await screen.findByRole("button", { name: /dismiss/i });
    fireEvent.click(btn);
    expect(screen.queryByText(/Getting started/)).not.toBeInTheDocument();
    expect(localStorage.getItem("vibe-dash-getting-started-dismissed")).toBe("1");
  });
});
