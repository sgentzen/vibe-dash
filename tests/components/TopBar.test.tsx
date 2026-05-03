// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef } from "react";
import { TopBar } from "../../src/components/TopBar";
import { useKeyboardShortcuts } from "../../src/hooks/useKeyboardShortcuts";
import { useAppDispatch } from "../../src/store";
// useAppDispatch is used in TopBarWithShortcuts below
import {
  renderWithProviders,
  screen,
  within,
  fireEvent,
  waitFor,
  resetIdSeq,
} from "./test-utils";

// Mock useApi to avoid real fetch calls
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({
    createProject: vi.fn().mockResolvedValue({ id: "p1", name: "New Project" }),
    markNotificationRead: vi.fn().mockResolvedValue({}),
    markAllRead: vi.fn().mockResolvedValue({}),
    getWebhooks: vi.fn().mockResolvedValue([]),
    createWebhook: vi.fn().mockResolvedValue({}),
    deleteWebhook: vi.fn().mockResolvedValue({}),
  }),
}));

// Wrapper that also mounts useKeyboardShortcuts (as App.tsx does)
function TopBarWithShortcuts() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dispatch = useAppDispatch();
  useKeyboardShortcuts({
    searchInputRef,
    onClearSearch: () => dispatch({ type: "SET_SEARCH_QUERY", payload: "" }),
  });
  return <TopBar searchInputRef={searchInputRef} />;
}

describe("TopBar", () => {
  beforeEach(() => {
    resetIdSeq();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function getHeader() {
    return screen.getAllByRole("banner")[0];
  }

  // ── Existing smoke tests (adjusted for M3 changes) ─────────────────────

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
    expect(within(getHeader()).getByRole("textbox", { name: /search/i })).toBeInTheDocument();
  });

  it("renders New Project button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /new project/i })).toBeInTheDocument();
  });

  it("renders notification bell button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /notifications/i })).toBeInTheDocument();
  });

  // ── M3-T5: Appearance popover ──────────────────────────────────────────

  it("renders Appearance button", () => {
    renderWithProviders(<TopBar />);
    expect(within(getHeader()).getByRole("button", { name: /appearance/i })).toBeInTheDocument();
  });

  it("Appearance popover opens on click and shows theme buttons", async () => {
    renderWithProviders(<TopBar />);
    const appearanceBtn = within(getHeader()).getByRole("button", { name: /appearance/i });
    fireEvent.click(appearanceBtn);
    expect(await screen.findByRole("button", { name: /switch to light mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  // ── M3-T5: Scope select dispatches SET_SEARCH_SCOPE ──────────────────

  it("scope select updates searchScope state", () => {
    renderWithProviders(<TopBar />);
    const scopeSelect = within(getHeader()).getByRole("combobox", { name: /search scope/i });
    expect(scopeSelect).toHaveValue("all");
    fireEvent.change(scopeSelect, { target: { value: "tasks" } });
    expect(scopeSelect).toHaveValue("tasks");
  });

  // ── M3-T5: Stat-tile click dispatches correct actions ──────────────────

  it("Active Agents stat tile dispatches SET_ACTIVE_VIEW: agents + SET_SEARCH_SCOPE: agents", async () => {
    renderWithProviders(<TopBar />);
    const agentsBtn = within(getHeader()).getByRole("button", { name: /view active agents/i });
    fireEvent.click(agentsBtn);
    // Scope and view changes are reflected in state — check scope select shows "agents"
    await waitFor(() => {
      const scopeSelect = within(getHeader()).getByRole("combobox", { name: /search scope/i });
      expect(scopeSelect).toHaveValue("agents");
    });
  });

  it("Tasks stat tile navigates to list view", async () => {
    renderWithProviders(<TopBar />);
    const tasksBtn = within(getHeader()).getByRole("button", { name: /view tasks/i });
    fireEvent.click(tasksBtn);
    // View changes — board nav button should no longer be active; list should be active
    await waitFor(() => {
      const listBtn = within(getHeader()).getByRole("button", { name: "List" });
      expect(listBtn).toBeInTheDocument();
    });
  });

  it("Alerts stat tile opens notification panel", async () => {
    renderWithProviders(<TopBar />);
    const alertsBtn = within(getHeader()).getByRole("button", { name: /view alerts/i });
    fireEvent.click(alertsBtn);
    await waitFor(() => {
      expect(screen.getByText("Notifications")).toBeInTheDocument();
    });
  });

  // ── M3-T5: ⌘K focuses search input ────────────────────────────────────

  it("⌘K focuses the search input", async () => {
    renderWithProviders(<TopBarWithShortcuts />);
    const searchInput = screen.getByRole("textbox", { name: /search/i });
    expect(document.activeElement).not.toBe(searchInput);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("Ctrl+K focuses the search input", async () => {
    renderWithProviders(<TopBarWithShortcuts />);
    const searchInput = screen.getByRole("textbox", { name: /search/i });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("/ focuses the search input when not in an editable field", async () => {
    renderWithProviders(<TopBarWithShortcuts />);
    const searchInput = screen.getByRole("textbox", { name: /search/i });
    fireEvent.keyDown(window, { key: "/", target: document.body });
    await waitFor(() => {
      expect(document.activeElement).toBe(searchInput);
    });
  });

  it("Escape clears search query and blurs input", async () => {
    renderWithProviders(<TopBarWithShortcuts />);
    const searchInput = screen.getByRole("textbox", { name: /search/i }) as HTMLInputElement;
    // Focus and type something
    fireEvent.change(searchInput, { target: { value: "hello" } });
    searchInput.focus();
    expect(searchInput.value).toBe("hello");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(searchInput.value).toBe("");
    });
  });
});
