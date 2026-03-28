import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { handleTool } from "../server/mcp/tools.js";

// Mock websocket broadcast — we don't need a live WebSocket server in tests
vi.mock("../server/websocket.js", () => ({
  broadcast: vi.fn(),
}));

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

function parse(result: { content: [{ type: string; text: string }] }) {
  return JSON.parse(result.content[0].text);
}

// ─── register_agent ───────────────────────────────────────────────────────────

describe("register_agent", () => {
  it("creates an agent and returns agent_id", async () => {
    const result = await handleTool(db, "register_agent", {
      name: "test-agent",
      model: "claude-3-5-sonnet",
      capabilities: ["read", "write"],
    });
    const data = parse(result);
    expect(data.agent_id).toBeTruthy();
    expect(typeof data.agent_id).toBe("string");
  });

  it("upserts an existing agent", async () => {
    const first = parse(await handleTool(db, "register_agent", { name: "agent-x", model: "model-a" }));
    const second = parse(await handleTool(db, "register_agent", { name: "agent-x", model: "model-b" }));
    expect(second.agent_id).toBe(first.agent_id);
  });
});

// ─── create_project ───────────────────────────────────────────────────────────

describe("create_project", () => {
  it("creates a project and returns project_id", async () => {
    const result = await handleTool(db, "create_project", { name: "My Project", description: "A test project" });
    const data = parse(result);
    expect(data.project_id).toBeTruthy();
    expect(typeof data.project_id).toBe("string");
  });
});

// ─── create_task ──────────────────────────────────────────────────────────────

describe("create_task", () => {
  it("creates a task and returns task_id", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));

    const result = await handleTool(db, "create_task", {
      project_id,
      title: "Do the thing",
      priority: "high",
    });
    const data = parse(result);
    expect(data.task_id).toBeTruthy();
  });
});

// ─── update_task ──────────────────────────────────────────────────────────────

describe("update_task", () => {
  it("updates task fields and returns success", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Original", priority: "low" }));

    const result = await handleTool(db, "update_task", {
      task_id,
      title: "Updated Title",
      status: "in_progress",
      progress: 50,
    });
    const data = parse(result);
    expect(data.success).toBe(true);

    // Verify with get_task
    const fetched = parse(await handleTool(db, "get_task", { task_id }));
    expect(fetched.task.title).toBe("Updated Title");
    expect(fetched.task.status).toBe("in_progress");
    expect(fetched.task.progress).toBe(50);
  });
});

// ─── complete_task ────────────────────────────────────────────────────────────

describe("complete_task", () => {
  it("marks task as done with 100% progress", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Finish me", priority: "medium" }));

    const result = await handleTool(db, "complete_task", { task_id });
    const data = parse(result);
    expect(data.success).toBe(true);

    const fetched = parse(await handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("done");
    expect(fetched.task.progress).toBe(100);
  });
});

// ─── log_activity ─────────────────────────────────────────────────────────────

describe("log_activity", () => {
  it("auto-registers agent and logs activity", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    const result = await handleTool(db, "log_activity", {
      task_id,
      agent_name: "new-agent",
      message: "Started working on this",
    });
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it("logs activity without an agent", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    const result = await handleTool(db, "log_activity", {
      task_id,
      message: "System event",
    });
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it("reuses existing agent without duplicating", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    // Register agent first
    const { agent_id } = parse(await handleTool(db, "register_agent", { name: "existing-agent" }));

    // log_activity should reuse the existing agent
    await handleTool(db, "log_activity", { task_id, agent_name: "existing-agent", message: "Hello" });

    // Register again — should still be same ID
    const { agent_id: after_id } = parse(await handleTool(db, "register_agent", { name: "existing-agent" }));
    expect(after_id).toBe(agent_id);
  });
});

// ─── report_blocker ───────────────────────────────────────────────────────────

describe("report_blocker", () => {
  it("reports a blocker on a task and returns blocker_id", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Blocked task", priority: "medium" }));

    const result = await handleTool(db, "report_blocker", {
      task_id,
      reason: "Waiting on external API",
    });
    const data = parse(result);
    expect(data.blocker_id).toBeTruthy();

    // Task should now be blocked
    const fetched = parse(await handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("blocked");
  });
});

// ─── resolve_blocker ──────────────────────────────────────────────────────────

describe("resolve_blocker", () => {
  it("resolves a blocker, reverts task to in_progress, and returns success", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(await handleTool(db, "create_task", { project_id, title: "Blocked task", priority: "medium" }));
    const { blocker_id } = parse(await handleTool(db, "report_blocker", { task_id, reason: "API down" }));

    const result = await handleTool(db, "resolve_blocker", { blocker_id });
    const data = parse(result);
    expect(data.success).toBe(true);

    // Task should revert to in_progress after blocker is resolved
    const fetched = parse(await handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("in_progress");
  });
});

// ─── list_projects / list_tasks ───────────────────────────────────────────────

describe("list operations", () => {
  it("list_projects returns all projects", async () => {
    await handleTool(db, "create_project", { name: "Alpha" });
    await handleTool(db, "create_project", { name: "Beta" });

    const result = await handleTool(db, "list_projects", {});
    const data = parse(result);
    expect(data.projects).toHaveLength(2);
    expect(data.projects.map((p: { name: string }) => p.name)).toContain("Alpha");
  });

  it("list_tasks returns tasks with filters", async () => {
    const { project_id } = parse(await handleTool(db, "create_project", { name: "P" }));
    await handleTool(db, "create_task", { project_id, title: "Task 1", priority: "low" });
    await handleTool(db, "create_task", { project_id, title: "Task 2", priority: "low" });

    const result = await handleTool(db, "list_tasks", { project_id });
    const data = parse(result);
    expect(data.tasks).toHaveLength(2);
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws on unknown tool name", async () => {
    await expect(handleTool(db, "unknown_tool", {})).rejects.toThrow("Unknown tool: unknown_tool");
  });
});
