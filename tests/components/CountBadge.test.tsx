// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CountBadge } from "../../src/components/dashboard/CountBadge";

/**
 * Resolve the description element the way an assistive technology would, by
 * following aria-describedby. Looking it up by its tooltip role would only work
 * while it is open, because the role is dropped once it closes.
 */
function tipFor(badgeName: string): HTMLElement {
  const badge = screen.getByRole("button", { name: badgeName });
  return document.getElementById(badge.getAttribute("aria-describedby") ?? "")!;
}

const isOpen = (badgeName: string) => tipFor(badgeName).style.clipPath === "";

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
    const tip = tipFor("3 unpriced");
    expect(tip.textContent).toBe(FLOOR);
    expect(tip.style.display).not.toBe("none");
    expect(tip.style.visibility).not.toBe("hidden");
  });

  it("only claims the tooltip role once it is actually showing", async () => {
    // A permanently-present node announcing itself as a tooltip is one more
    // thing for a browse-mode reader to trip over on the way past the badge.
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.tab();

    expect(screen.getByRole("tooltip").textContent).toBe(FLOOR);
  });

  it("drops the title attribute that the tooltip replaced", () => {
    // Leaving it would stack a native tooltip on top of the real one.
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByRole("button", { name: "3 unpriced" }).getAttribute("title")).toBeNull();
  });

  it("reveals the tooltip on keyboard focus, not just on hover", async () => {
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(isOpen("3 unpriced")).toBe(false);

    await user.tab();

    expect(screen.getByRole("button", { name: "3 unpriced" })).toBe(document.activeElement);
    // Visible now means laid out as a real tooltip rather than clipped away.
    expect(isOpen("3 unpriced")).toBe(true);
  });

  it("dismisses the tooltip on Escape while focus stays put", async () => {
    // WCAG 1.4.13 requires the content be dismissible without moving focus.
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);

    await user.tab();
    expect(isOpen("3 unpriced")).toBe(true);

    await user.keyboard("{Escape}");

    expect(isOpen("3 unpriced")).toBe(false);
    expect(screen.getByRole("button", { name: "3 unpriced" })).toBe(document.activeElement);
  });

  it("keeps the visible text readable on its own", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    expect(screen.getByText("3 unpriced")).toBeTruthy();
  });
});

// Pointer and focus are separate inputs, and 1.4.13 requires the tooltip to
// survive until the input that opened it goes away. An earlier version tracked
// one `visible` boolean, so whichever handler fired last won and either input
// leaving closed the tooltip out from under the other one.
describe("CountBadge tooltip persistence", () => {
  const FLOOR = "this figure is a floor";
  const open = () => isOpen("3 unpriced");

  it("stays open when the mouse leaves a badge that still has focus", async () => {
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });

    await user.tab();
    fireEvent.mouseEnter(badge.parentElement!);
    fireEvent.mouseLeave(badge.parentElement!);

    expect(badge).toBe(document.activeElement);
    expect(open()).toBe(true);
  });

  it("stays open when focus leaves a badge the mouse is still over", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });

    fireEvent.mouseEnter(badge.parentElement!);
    fireEvent.focus(badge);
    fireEvent.blur(badge);

    expect(open()).toBe(true);
  });

  it("closes once both the pointer and focus have gone", () => {
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });

    fireEvent.mouseEnter(badge.parentElement!);
    fireEvent.focus(badge);
    fireEvent.blur(badge);
    fireEvent.mouseLeave(badge.parentElement!);

    expect(open()).toBe(false);
  });

  it("reopens on a later hover after Escape dismissed it", async () => {
    // Escape suppresses the tooltip for the current visit only. Leaving and
    // coming back is a fresh request, not a dismissed one.
    const user = userEvent.setup();
    render(<CountBadge count={3} label="unpriced" explanation={FLOOR} />);
    const badge = screen.getByRole("button", { name: "3 unpriced" });

    await user.tab();
    await user.keyboard("{Escape}");
    expect(open()).toBe(false);

    fireEvent.blur(badge);
    fireEvent.mouseEnter(badge.parentElement!);

    expect(open()).toBe(true);
  });
});

// The Escape handler calls stopPropagation, which is only safe because it is
// gated on the tooltip actually being open. Ungated, a badge inside a drawer
// would swallow the drawer's own Escape-to-close whenever it held focus.
describe("CountBadge Escape bubbling", () => {
  const FLOOR = "this figure is a floor";

  const renderInDrawer = () => {
    const onEscape = vi.fn();
    render(
      <div
        onKeyDown={(e) => {
          if (e.key === "Escape") onEscape();
        }}
      >
        <CountBadge count={3} label="unpriced" explanation={FLOOR} />
      </div>,
    );
    return onEscape;
  };

  it("swallows Escape while the tooltip is open, so it dismisses only the tooltip", async () => {
    const user = userEvent.setup();
    const onEscape = renderInDrawer();

    await user.tab();
    await user.keyboard("{Escape}");

    expect(isOpen("3 unpriced")).toBe(false);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("lets Escape through when the badge is only focused, so a drawer still closes", async () => {
    const user = userEvent.setup();
    const onEscape = renderInDrawer();

    await user.tab();
    await user.keyboard("{Escape}"); // closes the tooltip, swallowed
    await user.keyboard("{Escape}"); // nothing open now, must reach the drawer

    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

// DashboardView renders two badges side by side in the Total Spend KPI, so the
// per-instance wiring has to actually be per-instance.
describe("CountBadge instances are independent", () => {
  it("gives each badge its own description target and its own open state", async () => {
    const user = userEvent.setup();
    render(
      <>
        <CountBadge count={3} label="unpriced" explanation="the total is a floor" />
        <CountBadge count={2} label="unattributed" explanation="not tied to an agent" />
      </>,
    );

    const first = screen.getByRole("button", { name: "3 unpriced" });
    const second = screen.getByRole("button", { name: "2 unattributed" });
    const firstTip = first.getAttribute("aria-describedby")!;
    const secondTip = second.getAttribute("aria-describedby")!;

    expect(firstTip).not.toBe(secondTip);
    expect(document.getElementById(firstTip)?.textContent).toBe("the total is a floor");
    expect(document.getElementById(secondTip)?.textContent).toBe("not tied to an agent");

    await user.tab();

    expect(first).toBe(document.activeElement);
    expect(document.getElementById(firstTip)!.style.clipPath).toBe("");
    expect(document.getElementById(secondTip)!.style.clipPath).toBe("inset(50%)");
  });
});
