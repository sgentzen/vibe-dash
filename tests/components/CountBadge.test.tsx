// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountBadge } from "../../src/components/dashboard/CountBadge";

describe("CountBadge", () => {
  it("renders the count and its label", () => {
    render(<CountBadge count={7} label="unpriced" title="seven of them" />);
    expect(screen.getByText("7 unpriced")).toBeTruthy();
  });

  it("renders nothing at zero, so a healthy install is unchanged", () => {
    const { container } = render(<CountBadge count={0} label="unpriced" title="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the count is absent", () => {
    // An older server, or a payload shape we did not expect.
    const { container } = render(<CountBadge count={undefined} label="unpriced" title="t" />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing for a nonsense count rather than rendering the nonsense", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -3]) {
      const { container } = render(<CountBadge count={bad} label="unpriced" title="t" />);
      expect(container.textContent).toBe("");
    }
  });

  it("carries its explanation as a title", () => {
    render(<CountBadge count={2} label="unpriced" title="the total is a floor" />);
    expect(screen.getByText("2 unpriced").getAttribute("title")).toBe("the total is a floor");
  });

  it("renders a fractional count as-is rather than silently rounding it", () => {
    // A non-integer is finite and positive, so the guard admits it. Silently
    // rounding would hide a real bug (e.g. a partial aggregation) behind a
    // clean-looking number.
    render(<CountBadge count={2.5} label="unpriced" title="t" />);
    expect(screen.getByText("2.5 unpriced")).toBeTruthy();
  });
});

// A title attribute reaches a mouse and nothing else: it is not announced
// reliably by screen readers and never appears on keyboard focus. The visible
// text says what; the accessible name has to carry why, because that is the
// part that decides whether a reader should trust the figure beside it.
describe("CountBadge accessibility", () => {
  it("exposes the explanation as its accessible name", () => {
    render(<CountBadge count={3} label="unpriced" title="this figure is a floor" />);
    expect(screen.getByLabelText("this figure is a floor")).toBeTruthy();
  });

  it("keeps the visible text readable on its own", () => {
    // The accessible name replaces the visible text for a screen reader, so
    // the visible text still has to stand alone for everyone else.
    render(<CountBadge count={3} label="unpriced" title="this figure is a floor" />);
    expect(screen.getByText("3 unpriced")).toBeTruthy();
  });
});
