// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DroppedDataNotice } from "../../src/components/dashboard/DroppedDataNotice";

const healthy = { otlpUnmapped: 0, otlpSeriesRefused: 0, otlpSeriesCount: 12 };

describe("DroppedDataNotice", () => {
  it("renders nothing on a healthy install", () => {
    const { container } = render(<DroppedDataNotice {...healthy} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the status is unavailable", () => {
    const { container } = render(<DroppedDataNotice />);
    expect(container.textContent).toBe("");
  });

  it("says so when points from an unrecognised runner were ignored", () => {
    render(<DroppedDataNotice {...healthy} otlpUnmapped={40} />);
    expect(screen.getByText(/40/)).toBeTruthy();
    expect(screen.getByText(/no mapper|not recognised/i)).toBeTruthy();
  });

  it("says so when the series cap refused points", () => {
    render(<DroppedDataNotice {...healthy} otlpSeriesRefused={5} />);
    expect(screen.getByText(/5/)).toBeTruthy();
  });

  it("warns when the series table is at its ceiling", () => {
    // The stealth case: a flood of zero-valued points fills the table and
    // writes no cost rows, so this count is the only evidence anywhere.
    render(<DroppedDataNotice otlpUnmapped={0} otlpSeriesRefused={0} otlpSeriesCount={10000} />);
    expect(screen.getByText(/10000|ceiling|full/i)).toBeTruthy();
  });

  it("says the point counters reset on restart", () => {
    render(<DroppedDataNotice {...healthy} otlpUnmapped={1} />);
    expect(screen.getByText(/restart/i)).toBeTruthy();
  });
});
