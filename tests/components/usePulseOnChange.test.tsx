// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePulseOnChange } from "../../src/hooks/usePulseOnChange";

describe("usePulseOnChange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("is false on first render and after an unchanged rerender", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    expect(result.current).toBe(false);
    rerender({ v: "planned" });
    expect(result.current).toBe(false);
  });

  it("becomes true when the value changes, then false after 800ms", () => {
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    rerender({ v: "in_progress" });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current).toBe(false);
  });

  it("does not pulse when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
    const { result, rerender } = renderHook(({ v }) => usePulseOnChange(v), { initialProps: { v: "planned" } });
    rerender({ v: "in_progress" });
    expect(result.current).toBe(false);
  });
});
