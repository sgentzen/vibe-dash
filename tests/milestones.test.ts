import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initDb,
  createProject,
  createMilestone,
  getMilestone,
  updateMilestone,
  completeMilestone,
  listMilestones,
  createTask,
  updateTask,
  getTask,
} from "../server/db/index.js";

let db: Database.Database;
let projectId: string;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
  const project = createProject(db, { name: "Test Project", description: null });
  projectId = project.id;
});

// ─── Milestone CRUD ─────────────────────────────────────────────────────────

describe("Milestone CRUD", () => {
  it("creates a milestone with required fields", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "v1.0 Release" });
    expect(ms.id).toBeDefined();
    expect(ms.project_id).toBe(projectId);
    expect(ms.title).toBe("v1.0 Release");
    expect(ms.status).toBe("open");
    expect(ms.description).toBeNull();
    expect(ms.due_date).toBeNull();
    expect(ms.completed_at).toBeNull();
  });

  it("creates a milestone with all optional fields", () => {
    const ms = createMilestone(db, {
      project_id: projectId,
      title: "v2.0 Release",
      description: "Major release",
      due_date: "2026-06-01",
    });
    expect(ms.description).toBe("Major release");
    expect(ms.due_date).toBe("2026-06-01");
  });

  it("gets a milestone by id", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "Alpha" });
    const fetched = getMilestone(db, ms.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Alpha");
  });

  it("returns null for non-existent milestone", () => {
    expect(getMilestone(db, "non-existent-id")).toBeNull();
  });

  it("updates milestone fields", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "Beta" });
    const updated = updateMilestone(db, ms.id, {
      title: "Beta Release",
      description: "Updated description",
      due_date: "2026-07-15",
    });
    expect(updated!.title).toBe("Beta Release");
    expect(updated!.description).toBe("Updated description");
    expect(updated!.due_date).toBe("2026-07-15");
  });

  it("update with no changes returns existing milestone", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "GA" });
    const same = updateMilestone(db, ms.id, {});
    expect(same!.title).toBe("GA");
  });

  it("completes a milestone", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "v1.0" });
    const completed = completeMilestone(db, ms.id);
    expect(completed!.status).toBe("closed");
    expect(completed!.completed_at).not.toBeNull();
  });

  it("lists milestones for a project", () => {
    createMilestone(db, { project_id: projectId, title: "M1" });
    createMilestone(db, { project_id: projectId, title: "M2" });
    const all = listMilestones(db, projectId);
    expect(all).toHaveLength(2);
  });

  it("filters milestones by status", () => {
    const ms1 = createMilestone(db, { project_id: projectId, title: "Open One" });
    createMilestone(db, { project_id: projectId, title: "Open Two" });
    completeMilestone(db, ms1.id);

    const open = listMilestones(db, projectId, "open");
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Open Two");

    const closed = listMilestones(db, projectId, "closed");
    expect(closed).toHaveLength(1);
    expect(closed[0].title).toBe("Open One");
  });
});

// ─── Task ↔ Milestone FK ───────────────────────────────────────────────────

describe("Task-Milestone association", () => {
  it("creates a task with milestone_id", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "v1.0" });
    const task = createTask(db, {
      project_id: projectId,
      title: "Implement feature",
      description: null,
      priority: "medium",
      milestone_id: ms.id,
    });
    expect(task.milestone_id).toBe(ms.id);
  });

  it("creates a task without milestone_id (null)", () => {
    const task = createTask(db, {
      project_id: projectId,
      title: "No milestone task",
      description: null,
      priority: "medium",
    });
    expect(task.milestone_id).toBeNull();
  });

  it("updates a task to assign a milestone", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "v1.0" });
    const task = createTask(db, {
      project_id: projectId,
      title: "Feature",
      description: null,
      priority: "medium",
    });
    const updated = updateTask(db, task.id, { milestone_id: ms.id });
    expect(updated!.milestone_id).toBe(ms.id);
  });

  it("updates a task to remove milestone (set null)", () => {
    const ms = createMilestone(db, { project_id: projectId, title: "v1.0" });
    const task = createTask(db, {
      project_id: projectId,
      title: "Feature",
      description: null,
      priority: "medium",
      milestone_id: ms.id,
    });
    const updated = updateTask(db, task.id, { milestone_id: null });
    expect(updated!.milestone_id).toBeNull();
  });

  it("rejects task creation with invalid milestone_id (FK constraint)", () => {
    expect(() => {
      createTask(db, {
        project_id: projectId,
        title: "Bad milestone ref",
        description: null,
        priority: "medium",
        milestone_id: "non-existent-milestone",
      });
    }).toThrow();
  });

  it("rejects task update with invalid milestone_id (FK constraint)", () => {
    const task = createTask(db, {
      project_id: projectId,
      title: "Feature",
      description: null,
      priority: "medium",
    });
    expect(() => {
      updateTask(db, task.id, { milestone_id: "non-existent-milestone" });
    }).toThrow();
  });
});
