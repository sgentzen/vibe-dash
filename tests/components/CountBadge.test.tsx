// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountBadge } from "../../src/components/dashboard/CountBadge";

describe("CountBadge", () => {
  it("renders the count and its label", () => {
    render(<CountBadge count={7} label="unpriced" explanation="seven of them" />);
    expect(screen.getByText("7 unpriced")).toBeTruthy();
  });

  it("renders nothing at zero, so a healthy install is unchanged", () => {
    const { container } = render(<CountBadge count={0} label="unpriced" explanation="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the count is absent", () => {
    // An older server, or a payload shape we did not expect.
    const { container } = render(<CountBadge count={undefined} label="unpriced" explanation="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a nonsense count rather than rendering the nonsense", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const { container } = render(<CountBadge count={bad} label="unpriced" explanation="t" />);
      expect(container.textContent).toBe("");
    }
  });

  it("renders a fractional count as-is rather than silently rounding it", () => {
    // A non-integer is finite and positive, so the guard admits it. Silently
    // rounding would hide a real bug (e.g. a partial aggregation) behind a
    // clean-looking number.
    render(<CountBadge count={2.5} label="unpriced" explanation="t" />);
    expect(screen.getByText("2.5 unpriced")).toBeTruthy();
  });
});

// A `title` attribute reaches a mouse and nothing else: it is announced
// inconsistently across screen readers and never opens on keyboard focus
// (WCAG 1.4.13, 4.1.2). These tests pin the paths that replaced it. Every one
// of them reaches the explanation without a hover, because that is the whole
// point: a keyboard-only or screen-reader user has no hover to give.
describe("CountBadge accessibility", () => {
  const FLOOR = "this figure is a floor";

  it("is a button, so it is focusable and has a role without needing tabIndex", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByRole("button", { name: "3 unpriced" })).toBeTruthy();
  });

  it("names itself with the visible text rather than replacing it", () => {
    // aria-label would override "3 unpriced" with the explanation, leaving a
    // screen reader unable to say which figure is qualified or by how much.
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });
    expect(badge.getAttribute("aria-label")).toBeNull();
    expect(badge.textContent).toBe("3 unpriced");
  });

  it("exposes the explanation as a description, with no hover required", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });
    const describedBy = badge.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(FLOOR);
  });

  it("keeps the described element in the DOM while the tooltip is closed", () => {
    // display:none or unmounting would take the description out of the
    // accessibility tree and leave aria-describedby pointing at nothing.
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe(FLOOR);
    expect(tip.style.display).not.toBe("none");
    expect(tip.style.visibility).not.toBe("hidden");
  });

  it("drops the title attribute that the tooltip replaced", () => {
    // Leaving it would stack a native tooltip on top of the real one.
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByRole("button", { name: "3 unpriced" }).getAttribute("title")).toBeNull();
  });

  it("reveals the tooltip on keyboard focus, not just on hover", async () => {
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByRole("tooltip").style.position).toBe("absolute");

    await user.tab();

    expect(screen.getByRole("button", { name: "3 unpriced" })).toBe(document.activeElement);
    // Visible now means laid out as a real tooltip rather than clipped away.
    expect(screen.getByRole("tooltip").style.clipPath).toBe("");
  });

  it("dismisses the tooltip on Escape while focus stays put", async () => {
    // WCAG 1.4.13 requires the content be dismissible without moving focus.
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);

    await user.tab();
    expect(screen.getByRole("tooltip").style.clipPath).toBe("");

    await user.keyboard("{Escape}");

    expect(screen.getByRole("tooltip").style.clipPath).toBe("inset(50%)");
    expect(screen.getByRole("button", { name: "3 unpriced" })).toBe(document.activeElement);
  });

  it("keeps the visible text readable on its own", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByText("3 unpriced")).toBeTruthy();
  });
});
