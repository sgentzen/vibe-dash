// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HelpOverlay } from "../../src/components/HelpOverlay";

// getHealth is mocked per test below (or left unmocked to exercise the
// failure path) rather than hitting a real fetch — same pattern as
// AgentDashboard.test.tsx.
const getHealthMock = vi.fn();
vi.mock("../../src/hooks/useApi", () => ({
  useApi: () => ({ getHealth: getHealthMock }),
}));

describe("HelpOverlay", () => {
  it("lists the shortcut groups and known shortcuts", () => {
    getHealthMock.mockResolvedValue({ ok: true });
    render(<HelpOverlay onClose={() => {}} />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Go to Fleet")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Show this help")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    getHealthMock.mockResolvedValue({ ok: true });
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close keyboard shortcuts/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows version and build identity once /api/health resolves", async () => {
    getHealthMock.mockResolvedValue({
      ok: true,
      version: "1.2.3",
      commit: "abcdef1234567890",
      buildTime: "2026-09-20T00:00:00Z",
    });
    render(<HelpOverlay onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/v1\.2\.3/)).toBeInTheDocument();
    });
    expect(screen.getByText(/abcdef1/)).toBeInTheDocument();
    expect(screen.getByText(/built 2026-09-20T00:00:00Z/)).toBeInTheDocument();
  });

  it("shows no build footer when commit and build time are unknown", async () => {
    getHealthMock.mockResolvedValue({ ok: true, version: "1.2.3", commit: "unknown", buildTime: "unknown" });
    render(<HelpOverlay onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/v1\.2\.3/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/unknown/)).not.toBeInTheDocument();
  });

  it("renders with no footer at all when the health fetch fails", async () => {
    getHealthMock.mockRejectedValue(new Error("network error"));
    render(<HelpOverlay onClose={() => {}} />);
    // Shortcuts remain usable even though the footer never appears.
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    await waitFor(() => expect(getHealthMock).toHaveBeenCalled());
    expect(screen.queryByText(/^Vibe Dash /)).not.toBeInTheDocument();
  });
});
