// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  readStoredAccentColor,
  sanitizeAccentColor,
} from "../../src/utils/accent";

describe("sanitizeAccentColor", () => {
  it("accepts and lowercases valid hex colors", () => {
    expect(sanitizeAccentColor("#1A2B3C")).toBe("#1a2b3c");
    expect(sanitizeAccentColor("#abc")).toBe("#abc");
    expect(sanitizeAccentColor("#11223344")).toBe("#11223344");
  });

  it("rejects non-hex / tainted values", () => {
    expect(sanitizeAccentColor("red")).toBeNull();
    expect(sanitizeAccentColor("#12")).toBeNull();
    expect(sanitizeAccentColor("javascript:alert(1)")).toBeNull();
    expect(sanitizeAccentColor("#fff; background:url(x)")).toBeNull();
    expect(sanitizeAccentColor("")).toBeNull();
    expect(sanitizeAccentColor(null)).toBeNull();
    expect(sanitizeAccentColor(undefined)).toBeNull();
  });
});

describe("readStoredAccentColor", () => {
  beforeEach(() => localStorage.clear());

  it("returns a sanitized value when storage holds a valid color", () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "#AABBCC");
    expect(readStoredAccentColor()).toBe("#aabbcc");
  });

  it("returns null when storage is empty", () => {
    expect(readStoredAccentColor()).toBeNull();
  });

  it("rejects a corrupted/tainted stored value (read-side sink)", () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "#fff;}body{display:none}");
    expect(readStoredAccentColor()).toBeNull();
  });

  it("DEFAULT_ACCENT is itself a valid hex color", () => {
    expect(sanitizeAccentColor(DEFAULT_ACCENT)).toBe(DEFAULT_ACCENT);
  });
});
