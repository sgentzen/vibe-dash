import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { linkProjectPath, listProjectPaths } from "../server/db/projectPaths.js";
import { normalisePath, buildAttributor } from "../server/ingest/transcripts/attribute.js";

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
