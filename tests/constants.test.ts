import { describe, it, expect } from "vitest";
import { clampLimit } from "../server/constants.js";

describe("clampLimit", () => {
  it("passes through an in-range limit", () => {
    expect(clampLimit("50", 100, 500)).toBe(50);
    expect(clampLimit(200, 100, 500)).toBe(200);
  });

  it("caps an oversized limit at max", () => {
    expect(clampLimit("999999", 100, 500)).toBe(500);
    expect(clampLimit(10_000, 100, 500)).toBe(500);
    expect(clampLimit("1e999", 100, 500)).toBe(100); // Infinity -> non-finite -> fallback
  });

  it("falls back for absent, non-numeric, or non-positive input", () => {
    expect(clampLimit(undefined, 100, 500)).toBe(100);
    expect(clampLimit("abc", 100, 500)).toBe(100);
    expect(clampLimit("0", 100, 500)).toBe(100);
    expect(clampLimit("-5", 100, 500)).toBe(100);
    expect(clampLimit(null, 100, 500)).toBe(100);
    expect(clampLimit(["50", "60"], 100, 500)).toBe(100); // array coerces to NaN
  });

  it("caps the fallback itself to max", () => {
    expect(clampLimit(undefined, 9999, 500)).toBe(500);
  });

  it("floors fractional limits", () => {
    expect(clampLimit("7.9", 100, 500)).toBe(7);
  });
});
