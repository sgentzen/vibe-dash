/**
 * Regression tests for the milestone feature, including the FK bug where
 * create_task / update_task would fail with "FOREIGN KEY constraint failed"
 * whenever milestone_id was supplied.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createTask,
  getTask,
  updateTask,
  createMilestone,
  getMilestone,
  listMilestones,
  updateMilestone,
  completeMilestone,
  searchTasks,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── Milestone CRUD ───────────────────────────────────────────────────────────

describe("milestones", () => {
  it("creates a milestone and retrieves it", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, {
      project_id: project.id,
      name: "R8b — Analytics & Quality",
      description: "Analytics and quality improvements",
      acceptance_criteria: "routes split, error middleware",
      target_date: "2026-04-18",
    });

    expect(ms.id).toBeTruthy();
    expect(ms.name).toBe("R8b — Analytics & Quality");
    expect(ms.project_id).toBe(project.id);
    expect(ms.status).toBe("open");
    expect(ms.acceptance_criteria).toBe("routes split, error middleware");
    expect(ms.target_date).toBe("2026-04-18");
    expect(ms.created_at).toBeTruthy();

    const fetched = getMilestone(db, ms.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("R8b — Analytics & Quality");
  });

  it("lists milestones filtered by project", () => {
    const p1 = createProject(db, { name: "p1", description: null });
    const p2 = createProject(db, { name: "p2", description: null });
    createMilestone(db, { project_id: p1.id, name: "M1" });
    createMilestone(db, { project_id: p1.id, name: "M2" });
    createMilestone(db, { project_id: p2.id, name: "M3" });

    expect(listMilestones(db, p1.id)).toHaveLength(2);
    expect(listMilestones(db, p2.id)).toHaveLength(1);
    expect(listMilestones(db)).toHaveLength(3);
  });

  it("updates milestone fields", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "Original" });

    const updated = updateMilestone(db, ms.id, {
      name: "Updated",
      target_date: "2026-05-01",
      acceptance_criteria: "criterion 1",
    });

    expect(updated!.name).toBe("Updated");
    expect(updated!.target_date).toBe("2026-05-01");
    expect(updated!.acceptance_criteria).toBe("criterion 1");
  });

  it("completes a milestone", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "R8b" });
    expect(ms.status).toBe("open");

    const completed = completeMilestone(db, ms.id);
    expect(completed!.status).toBe("achieved");
  });

  it("returns null for a non-existent milestone", () => {
    expect(getMilestone(db, "non-existent-id")).toBeNull();
  });
});

// ─── FK regression: create_task with milestone_id ─────────────────────────────

describe("create_task with milestone_id (FK regression)", () => {
  it("creates a task linked to a milestone without FK error", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "R8b" });

    // This should NOT throw "FOREIGN KEY constraint failed"
    const task = createTask(db, {
      project_id: project.id,
      milestone_id: ms.id,
      title: "Split routes.ts",
      description: null,
      priority: "high",
    });

    expect(task.id).toBeTruthy();
    expect(task.milestone_id).toBe(ms.id);
  });

  it("creates a task with null milestone_id (no FK reference)", () => {
    const project = createProject(db, { name: "proj", description: null });
    const task = createTask(db, {
      project_id: project.id,
      milestone_id: null,
      title: "No milestone",
      description: null,
      priority: "medium",
    });
    expect(task.milestone_id).toBeNull();
  });

  it("rejects a task with a non-existent milestone_id", () => {
    const project = createProject(db, { name: "proj", description: null });
    expect(() =>
      createTask(db, {
        project_id: project.id,
        milestone_id: "00000000-0000-0000-0000-000000000000",
        title: "Bad ref",
        description: null,
        priority: "medium",
      })
    ).toThrow();
  });
});

// ─── FK regression: update_task with milestone_id ─────────────────────────────

describe("update_task with milestone_id (FK regression)", () => {
  it("assigns an existing milestone to a task without FK error", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "R8b" });
    const task = createTask(db, {
      project_id: project.id,
      title: "Task without milestone",
      description: null,
      priority: "medium",
    });
    expect(task.milestone_id).toBeNull();

    // This should NOT throw "FOREIGN KEY constraint failed"
    const updated = updateTask(db, task.id, { milestone_id: ms.id });
    expect(updated!.milestone_id).toBe(ms.id);
  });

  it("clears a milestone_id by setting it to null", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "R8b" });
    const task = createTask(db, {
      project_id: project.id,
      milestone_id: ms.id,
      title: "Task with milestone",
      description: null,
      priority: "medium",
    });

    const updated = updateTask(db, task.id, { milestone_id: null });
    expect(updated!.milestone_id).toBeNull();
  });

  it("rejects update with a non-existent milestone_id", () => {
    const project = createProject(db, { name: "proj", description: null });
    const task = createTask(db, {
      project_id: project.id,
      title: "Task",
      description: null,
      priority: "medium",
    });
    expect(() =>
      updateTask(db, task.id, { milestone_id: "00000000-0000-0000-0000-000000000000" })
    ).toThrow();
  });

  it("getTask returns milestone_id field correctly", () => {
    const project = createProject(db, { name: "proj", description: null });
    const ms = createMilestone(db, { project_id: project.id, name: "R8b" });
    const task = createTask(db, {
      project_id: project.id,
      milestone_id: ms.id,
      title: "Linked task",
      description: null,
      priority: "high",
    });

    const fetched = getTask(db, task.id);
    expect(fetched!.milestone_id).toBe(ms.id);
  });
});

// ─── searchTasks milestone_id filter ─────────────────────────────────────────

describe("searchTasks milestone_id filter", () => {
  it("returns only tasks belonging to the given milestone", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, {
      project_id: project.id,
      name: "v1.0",
    });

    const taskWithMilestone = createTask(db, {
      project_id: project.id,
      title: "In milestone",
      description: null,
      priority: "medium",
      milestone_id: milestone.id,
    });

    createTask(db, {
      project_id: project.id,
      title: "No milestone",
      description: null,
      priority: "medium",
    });

    const results = searchTasks(db, { milestone_id: milestone.id });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(taskWithMilestone.id);
    expect(results[0].milestone_id).toBe(milestone.id);
  });

  it("returns all tasks when milestone_id is not specified", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, {
      project_id: project.id,
      name: "v1.0",
    });

    createTask(db, {
      project_id: project.id,
      title: "In milestone",
      description: null,
      priority: "medium",
      milestone_id: milestone.id,
    });

    createTask(db, {
      project_id: project.id,
      title: "No milestone",
      description: null,
      priority: "medium",
    });

    const results = searchTasks(db, {});

    expect(results).toHaveLength(2);
  });

  it("returns empty array when no tasks match the milestone", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, {
      project_id: project.id,
      name: "v2.0",
    });

    createTask(db, {
      project_id: project.id,
      title: "No milestone",
      description: null,
      priority: "medium",
    });

    const results = searchTasks(db, { milestone_id: milestone.id });

    expect(results).toHaveLength(0);
  });

  it("combines milestone_id with other filters", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, {
      project_id: project.id,
      name: "v1.0",
    });

    createTask(db, {
      project_id: project.id,
      title: "High priority milestone task",
      description: null,
      priority: "high",
      milestone_id: milestone.id,
    });

    createTask(db, {
      project_id: project.id,
      title: "Low priority milestone task",
      description: null,
      priority: "low",
      milestone_id: milestone.id,
    });

    const results = searchTasks(db, {
      milestone_id: milestone.id,
      priority: "high",
    });

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("High priority milestone task");
  });
});
