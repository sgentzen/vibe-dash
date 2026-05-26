import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { recordMilestoneChange, listMilestoneHistorySince } from "../server/db/milestone_history.js";
import { createProject, createMilestone, updateMilestone } from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => { db = createTestDb(); });

describe("milestone_history helpers", () => {
  it("records and lists changes in range", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    recordMilestoneChange(db, m.id, "name", "M", "M2");
    recordMilestoneChange(db, m.id, "target_date", null, "2026-06-01");

    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.field).sort((a, b) => a.localeCompare(b))).toEqual(["name", "target_date"]);
  });

  it("excludes rows before the cutoff", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M" });
    db.prepare(
      "INSERT INTO milestone_history (id, milestone_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("h-old", m.id, "name", "a", "b", "2020-01-01T00:00:00Z");
    const rows = listMilestoneHistorySince(db, "2026-01-01T00:00:00Z");
    expect(rows).toHaveLength(0);
  });
});

describe("updateMilestone history hook", () => {
  it("writes a history row when a watched field changes", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "Original" });
    updateMilestone(db, m.id, { name: "Renamed" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "name", old_value: "Original", new_value: "Renamed" });
  });

  it("writes nothing when the new value equals the old", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "Same" });
    updateMilestone(db, m.id, { name: "Same" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows).toHaveLength(0);
  });

  it("writes one row per changed watched field", () => {
    const p = createProject(db, { name: "P", description: null });
    const m = createMilestone(db, { project_id: p.id, name: "M", description: "old desc" });
    updateMilestone(db, m.id, { name: "M2", description: "new desc", target_date: "2026-06-01" });
    const rows = listMilestoneHistorySince(db, "2000-01-01T00:00:00Z");
    expect(rows.map((r) => r.field).sort((a, b) => a.localeCompare(b))).toEqual(["description", "name", "target_date"]);
  });
});
