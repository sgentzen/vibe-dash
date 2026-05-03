// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TopBar } from "../../src/components/TopBar";
import {
  renderWithProviders,
  screen,
  within,
  resetIdSeq,
} from "./test-utils";

// Mock useApi to avoid real fetch calls
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({
    createProject: vi.fn().mockResolvedValue({ id: "p1", name: "New Project" }),
    markNotificationRead: vi.fn().mockResolvedValue({}),
    getWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({}),
    deleteWebhook: vi.fn().mockResolvedValue({}),
  }),
}));

describe("TopBar", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  function getHeader() {
    // TopBar renders a <header> — grab the first one
    return screen.getAllByRole("banner")[0];
  }

  it("renders VIBE DASH logo text", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByText("VIBE DASH")).toBeInTheDocument();
  });

  it("renders stat counters", () => {
    renderWithProviders(<TopBar />);
    const header = getHeader();
    expect(within(header).getByText("PROJECTS")).toBeInTheDocument();
    expect(within(header).getByText("ACTIVE AGENTS")).toBeInTheDocument();
    expect(within(header).getByText("ALERTS")).toBeInTheDocument();
    expect(within(header).getByText("TASKS")).toBeInTheDocument();
  });

  it("renders navigation buttons", () => {
    renderWithProviders(<TopBar />);
    const header = getHeader();
    expect(within(header).getByRole("button", { name: "Board" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Agents" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Dash" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Timeline" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Activity" })).toBeInTheDocument();
  });

  it("renders search input", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByPlaceholderText("Search tasks...")).toBeInTheDocument();
  });

  it("renders theme toggle button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /switch to.*mode/i })).toBeInTheDocument();
  });

  it("renders New Project button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /new project/i })).toBeInTheDocument();
  });

  it("renders notification bell button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /notifications/i })).toBeInTheDocument();
  });
});
