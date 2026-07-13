// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpOverlay } from "../../src/components/HelpOverlay";

describe("HelpOverlay", () => {
  it("lists the shortcut groups and known shortcuts", () => {
    render(<HelpOverlay onClose={() => {}} />);
    expect(screen.getByText("Keyboard Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Go to Fleet")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Show this help")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<HelpOverlay onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close keyboard shortcuts/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
