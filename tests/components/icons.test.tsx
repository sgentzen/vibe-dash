// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "../../src/components/icons/Icon";

describe("Icon", () => {
  it("renders an svg and is aria-hidden when decorative", () => {
    const { container } = render(<Icon name="palette" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("is an img role with a title when labelled", () => {
    const { getByRole } = render(<Icon name="moon" title="Dark mode" />);
    expect(getByRole("img", { name: "Dark mode" })).toBeTruthy();
  });

  it("inherits currentColor by default and honors size", () => {
    const { container } = render(<Icon name="chevronLeft" size={20} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });
});
