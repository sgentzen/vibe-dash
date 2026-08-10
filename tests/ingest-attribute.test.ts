import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { linkProjectPath, listProjectPaths, RootPathError } from "../server/db/projectPaths.js";
import { normalisePath, isRootPath, buildAttributor } from "../server/ingest/transcripts/attribute.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("normalisePath", () => {
  it("converts separators and strips a trailing slash", () => {
    expect(normalisePath("C:\\Users\\sgent\\projects\\demo\\")).toBe("c:/users/sgent/projects/demo");
  });

  it("lowercases on Windows only", () => {
    const out = normalisePath("/home/Dev/App");
    expect(out).toBe(process.platform === "win32" ? "/home/dev/app" : "/home/Dev/App");
  });

  it("does not require the path to exist on disk", () => {
    // Historical transcripts name directories that may since have been deleted.
    expect(normalisePath("C:\\gone\\forever")).toBe("c:/gone/forever");
  });

  it("never collapses a root to the empty string", () => {
    // "" would make the prefix test in buildAttributor read
    // `target.startsWith("/")`, which every POSIX path satisfies.
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("///")).toBe("/");
    expect(normalisePath("\\")).toBe("/");
  });
});

describe("root paths", () => {
  it("is recognised for both a POSIX root and a bare drive", () => {
    expect(isRootPath("/")).toBe(true);
    expect(isRootPath("c:")).toBe(true);
    expect(isRootPath("C:")).toBe(true);
    expect(isRootPath("/home/dev")).toBe(false);
    expect(isRootPath("c:/repos")).toBe(false);
  });

  it("is refused at the link boundary rather than stored", () => {
    const project = createProject(db, { name: "demo", description: null });
    expect(() => linkProjectPath(db, project.id, "/")).toThrow(RootPathError);
    expect(listProjectPaths(db, project.id)).toHaveLength(0);
  });

  it("does not swallow unrelated paths even if one is stored directly", () => {
    // Belt and braces: the link boundary refuses a root, so this bypasses it
    // and writes the row by hand. Even then the matcher must not treat "/" as
    // a prefix of every POSIX path.
    const rootProject = createProject(db, { name: "catch-all", description: null });
    const realProject = createProject(db, { name: "real", description: null });
    db.prepare(
      `INSERT INTO project_paths (id, project_id, path, created_at)
       VALUES ('root-link', ?, '/', '2026-08-09T00:00:00.000Z')`
    ).run(rootProject.id);
    linkProjectPath(db, realProject.id, "/home/dev/real");

    const attribute = buildAttributor(db);
    expect(attribute("/home/dev/unrelated")).toBeNull();
    expect(attribute("/etc")).toBeNull();
    // The genuinely linked directory still wins for its own subtree.
    expect(attribute("/home/dev/real/src")).toBe(realProject.id);
  });
});

describe("buildAttributor", () => {
  it("matches an exact linked path", () => {
    const project = createProject(db, { name: "demo", description: null });
    linkProjectPath(db, project.id, "C:\\Users\\sgent\\projects\\demo");
    expect(buildAttributor(db)("C:\\Users\\sgent\\projects\\demo")).toBe(project.id);
  });

  it("matches a subdirectory by longest prefix", () => {
    const outer = createProject(db, { name: "outer", description: null });
    const inner = createProject(db, { name: "inner", description: null });
    linkProjectPath(db, outer.id, "C:/repos");
    linkProjectPath(db, inner.id, "C:/repos/inner");

    expect(buildAttributor(db)("C:/repos/inner/src")).toBe(inner.id);
    expect(buildAttributor(db)("C:/repos/other/src")).toBe(outer.id);
  });

  it("does not match a sibling that merely shares a prefix string", () => {
    const project = createProject(db, { name: "demo", description: null });
    linkProjectPath(db, project.id, "C:/repos/demo");
    // "C:/repos/demo-old" starts with "C:/repos/demo" as a string but is a
    // different directory. Matching it would attribute money to the wrong project.
    expect(buildAttributor(db)("C:/repos/demo-old")).toBeNull();
  });

  it("returns null when nothing matches, rather than guessing", () => {
    createProject(db, { name: "demo", description: null });
    expect(buildAttributor(db)("C:/somewhere/else")).toBeNull();
  });

  it("returns null for a record with no cwd", () => {
    expect(buildAttributor(db)(null)).toBeNull();
  });
});

describe("linkProjectPath", () => {
  it("stores the normalised form so lookups are plain string comparisons", () => {
    const project = createProject(db, { name: "demo", description: null });
    linkProjectPath(db, project.id, "C:\\Users\\sgent\\projects\\Demo\\");
    expect(listProjectPaths(db, project.id)[0].path).toBe(normalisePath("C:\\Users\\sgent\\projects\\Demo"));
  });
});

describe("normalisePath on pathological input", () => {
  // normalisePath runs on the `path` field of POST /api/ingest/paths, so its
  // input is request-controlled. The trailing-slash trim used to be /\/+$/,
  // which backtracks super-linearly on a long run of slashes (CodeQL
  // js/polynomial-redos). These assert the linear index-based trim: if it ever
  // regresses to a backtracking regex, they stop returning and the suite times
  // out rather than quietly passing.
  it("collapses a very long run of slashes to the root", () => {
    expect(normalisePath("/".repeat(50_000))).toBe("/");
  });

  it("trims a very long trailing run without touching the path itself", () => {
    const expected = normalisePath("C:/repos/demo");
    expect(normalisePath(`C:/repos/demo${"/".repeat(50_000)}`)).toBe(expected);
  });

  it("handles a long run of backslashes, which are converted first", () => {
    expect(normalisePath("\\".repeat(50_000))).toBe("/");
  });
});
