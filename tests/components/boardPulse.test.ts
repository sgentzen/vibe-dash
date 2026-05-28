import { describe, it, expect } from "vitest";
import { newlyAppearedIds } from "../../src/utils/boardPulse";

describe("newlyAppearedIds", () => {
  it("returns ids present now but not in the known set", () => {
    const known = new Set(["a", "b"]);
    const res = newlyAppearedIds(known, [{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect([...res]).toEqual(["c"]);
  });
  it("returns empty when nothing is new", () => {
    const known = new Set(["a", "b"]);
    expect(newlyAppearedIds(known, [{ id: "a" }]).size).toBe(0);
  });
});
