// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { RailDrawers } from "../../src/components/RailDrawers";

// Small harness that mirrors how App.tsx wires drawer state through RailDrawers,
// without pulling in the full App (which kicks off real data loading on mount).
function Harness() {
  const [drawer, setDrawer] = useState<null | "left" | "right">(null);
  return (
    <RailDrawers
      drawer={drawer}
      onOpenLeft={() => setDrawer("left")}
      onOpenRight={() => setDrawer("right")}
      onClose={() => setDrawer(null)}
      left={<div data-testid="left-content">Projects panel</div>}
      right={<div data-testid="right-content">Agent feed panel</div>}
      topRow={<div data-testid="top-row-content">Context chip</div>}
    >
      <div data-testid="center-content">Center content</div>
    </RailDrawers>
  );
}

describe("RailDrawers", () => {
  it("opens the projects drawer via the left toggle and closes it via backdrop click", () => {
    render(<Harness />);

    // Closed by default.
    expect(document.querySelector(".rail-left.rail-open")).toBeFalsy();

    const openBtn = screen.getByLabelText("Open projects");
    fireEvent.click(openBtn);

    expect(document.querySelector(".rail-left.rail-open")).toBeTruthy();
    expect(screen.getByTestId("left-content")).toBeVisible();

    fireEvent.click(document.querySelector(".drawer-backdrop")!);
    expect(document.querySelector(".rail-left.rail-open")).toBeFalsy();
  });

  it("opens the agent feed drawer via the right toggle", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText("Open agent feed"));
    expect(document.querySelector(".rail-right.rail-open")).toBeTruthy();
    expect(document.querySelector(".rail-left.rail-open")).toBeFalsy();
  });

  it("does not render a backdrop when no drawer is open", () => {
    render(<Harness />);
    expect(document.querySelector(".drawer-backdrop")).toBeFalsy();
  });

  it("backdrop click invokes onClose", () => {
    const onClose = vi.fn();
    render(
      <RailDrawers
        drawer="left"
        onOpenLeft={vi.fn()}
        onOpenRight={vi.fn()}
        onClose={onClose}
        left={<div />}
        right={<div />}
        topRow={<div />}
      >
        <div />
      </RailDrawers>,
    );
    // RailDrawers itself doesn't own the keydown listener (App.tsx does),
    // but clicking the backdrop should invoke the same onClose callback.
    fireEvent.click(document.querySelector(".drawer-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reflects open state via aria-expanded on the edge toggle buttons", () => {
    render(<Harness />);

    const leftToggle = screen.getByLabelText("Open projects");
    const rightToggle = screen.getByLabelText("Open agent feed");

    expect(leftToggle).toHaveAttribute("aria-expanded", "false");
    expect(rightToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(leftToggle);
    expect(leftToggle).toHaveAttribute("aria-expanded", "true");
    expect(rightToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("resolves the edge toggle button's fontSize to 12px", () => {
    render(<Harness />);
    const leftToggle = screen.getByLabelText("Open projects");
    expect(leftToggle.style.fontSize).toBe("12px");
  });
});
