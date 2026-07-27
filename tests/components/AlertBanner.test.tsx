// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { AlertBanner } from "../../src/components/AlertBanner";
import {
  renderWithProviders,
  makeBlocker,
  screen,
  resetIdSeq,
} from "./test-utils";

beforeEach(() => {
  resetIdSeq();
});

describe("AlertBanner", () => {
  it("renders nothing when there are no blockers", () => {
    const { container } = renderWithProviders(<AlertBanner />, { seed: { blockers: [] } });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the most recent blocker reason", () => {
    renderWithProviders(<AlertBanner />, {
      seed: { blockers: [makeBlocker({ reason: "older" }), makeBlocker({ reason: "newest" })] },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("newest");
    expect(alert).not.toHaveTextContent("older");
  });

  it("counts the remaining blockers as +N more", () => {
    renderWithProviders(<AlertBanner />, {
      seed: { blockers: [makeBlocker(), makeBlocker(), makeBlocker()] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("+2 more");
  });

  it("omits the count suffix for a single blocker", () => {
    renderWithProviders(<AlertBanner />, { seed: { blockers: [makeBlocker()] } });
    expect(screen.getByRole("alert")).not.toHaveTextContent("more");
  });
});
