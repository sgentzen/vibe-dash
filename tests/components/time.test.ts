import { describe, it, expect } from "vitest";
import { relativeTime } from "../../src/utils/time";

describe("relativeTime", () => {
  it("formats seconds, minutes, hours, days", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 5_000).toISOString())).toBe("5s ago");
    expect(relativeTime(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(relativeTime(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });
});
