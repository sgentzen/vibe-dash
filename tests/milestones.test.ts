import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  initDb,
  createProject,
  createTask,
  createMilestone,
  searchTasks,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  initDb(db);
});

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
