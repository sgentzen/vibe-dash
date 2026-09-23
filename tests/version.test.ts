import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { readPackageVersion, resolveCommit, resolveBuildTime } from "../server/version.js";

// node:child_process's named exports are non-configurable under ESM, so
// vi.spyOn on the real module throws ("Cannot redefine property") the way it
// doesn't for node:fs's readFileSync above. vi.mock with importOriginal wraps
// the real implementation in a vi.fn() at module-load time instead, which
// individual tests can then reconfigure via mockImplementation/mockRestore.
const { execFileSync: mockExecFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  mockExecFileSync.mockImplementation(actual.execFileSync);
  return { ...actual, execFileSync: mockExecFileSync };
});

// Every mock in this file is a spy on a real module (fs, child_process), so
// restore after every test regardless of which describe block set it up —
// a leaked mock in resolveCommit's tests would otherwise silently break
// readPackageVersion's real-filesystem test if file order ever changed.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("readPackageVersion", () => {
  it("reads the real version from this checkout's package.json", () => {
    // Not mocked: exercises the actual dev/tsx-layout candidate path
    // (resolveDistDir()'s pattern in server/index.ts), matching what
    // tests/system-routes.test.ts pins on the live GET /api/health response.
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("falls back to \"unknown\" when no candidate package.json can be read", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(readPackageVersion()).toBe("unknown");
  });

  it("falls back to \"unknown\" when package.json has no usable version field", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ name: "vibe-dash" }));
    expect(readPackageVersion()).toBe("unknown");
  });

  it("falls back to \"unknown\" when package.json is not valid JSON", () => {
    vi.spyOn(fs, "readFileSync").mockReturnValue("{not valid json");
    expect(readPackageVersion()).toBe("unknown");
  });
});

describe("resolveCommit", () => {
  const ORIGINAL = process.env.VIBE_DASH_COMMIT_SHA;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VIBE_DASH_COMMIT_SHA;
    else process.env.VIBE_DASH_COMMIT_SHA = ORIGINAL;
  });

  it("uses VIBE_DASH_COMMIT_SHA when set", () => {
    process.env.VIBE_DASH_COMMIT_SHA = "deadbeefcafe";
    expect(resolveCommit()).toBe("deadbeefcafe");
  });

  it("falls through to git when VIBE_DASH_COMMIT_SHA is set but empty", () => {
    // The Docker ARG default is "" when no --build-arg is passed (see
    // Dockerfile), so an empty string must be treated the same as unset
    // rather than becoming the literal commit value.
    process.env.VIBE_DASH_COMMIT_SHA = "";
    const result = resolveCommit();
    expect(result).not.toBe("");
    // This checkout is a real git repo, so the git fallback should succeed
    // with a 40-character SHA rather than falling all the way to "unknown".
    expect(result).toMatch(/^[0-9a-f]{40}$/);
  });

  it("falls back to \"unknown\" when git itself fails", () => {
    delete process.env.VIBE_DASH_COMMIT_SHA;
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error("git not found");
    });
    expect(resolveCommit()).toBe("unknown");
  });
});

describe("resolveBuildTime", () => {
  const ORIGINAL = process.env.VIBE_DASH_BUILD_TIME;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.VIBE_DASH_BUILD_TIME;
    else process.env.VIBE_DASH_BUILD_TIME = ORIGINAL;
  });

  it("uses VIBE_DASH_BUILD_TIME when set", () => {
    process.env.VIBE_DASH_BUILD_TIME = "2026-09-20T00:00:00Z";
    expect(resolveBuildTime()).toBe("2026-09-20T00:00:00Z");
  });

  it("falls back to \"unknown\" when VIBE_DASH_BUILD_TIME is set but empty", () => {
    process.env.VIBE_DASH_BUILD_TIME = "";
    expect(resolveBuildTime()).toBe("unknown");
  });

  it("falls back to \"unknown\" when unset", () => {
    delete process.env.VIBE_DASH_BUILD_TIME;
    expect(resolveBuildTime()).toBe("unknown");
  });
});
