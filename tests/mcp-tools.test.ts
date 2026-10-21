import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { handleTool } from "../server/mcp/tools.js";
import { createMcpServer } from "../server/mcp/server.js";
import { broadcast } from "../server/websocket.js";

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
  it("creates an agent and returns agent_id", () => {
    const result = handleTool(db, "register_agent", {
      name: "test-agent",
      model: "claude-3-5-sonnet",
      capabilities: ["read", "write"],
    });
    const data = parse(result);
    expect(data.agent_id).toBeTruthy();
    expect(typeof data.agent_id).toBe("string");
  });

  it("upserts an existing agent", () => {
    const first = parse(handleTool(db, "register_agent", { name: "agent-x", model: "model-a" }));
    const second = parse(handleTool(db, "register_agent", { name: "agent-x", model: "model-b" }));
    expect(second.agent_id).toBe(first.agent_id);
  });
});

// ─── create_task ──────────────────────────────────────────────────────────────

describe("create_task", () => {
  it("creates a task and returns task_id", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));

    const result = handleTool(db, "create_task", {
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
  it("updates task fields and returns success", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Original", priority: "low" }));

    const result = handleTool(db, "update_task", {
      task_id,
      title: "Updated Title",
      status: "in_progress",
      progress: 50,
    });
    const data = parse(result);
    expect(data.success).toBe(true);

    // Verify with get_task
    const fetched = parse(handleTool(db, "get_task", { task_id }));
    expect(fetched.task.title).toBe("Updated Title");
    expect(fetched.task.status).toBe("in_progress");
    expect(fetched.task.progress).toBe(50);
  });
});

// ─── complete_task ────────────────────────────────────────────────────────────

describe("complete_task", () => {
  it("marks task as done with 100% progress", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Finish me", priority: "medium" }));

    const result = handleTool(db, "complete_task", { task_id });
    const data = parse(result);
    expect(data.success).toBe(true);

    const fetched = parse(handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("done");
    expect(fetched.task.progress).toBe(100);
  });
});

// ─── log_activity ─────────────────────────────────────────────────────────────

describe("log_activity", () => {
  it("auto-registers agent and logs activity", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    const result = handleTool(db, "log_activity", {
      task_id,
      agent_name: "new-agent",
      message: "Started working on this",
    });
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it("logs activity without an agent", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    const result = handleTool(db, "log_activity", {
      task_id,
      message: "System event",
    });
    const data = parse(result);
    expect(data.success).toBe(true);
  });

  it("reuses existing agent without duplicating", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Task", priority: "low" }));

    // Register agent first
    const { agent_id } = parse(handleTool(db, "register_agent", { name: "existing-agent" }));

    // log_activity should reuse the existing agent
    handleTool(db, "log_activity", { task_id, agent_name: "existing-agent", message: "Hello" });

    // Register again — should still be same ID
    const { agent_id: after_id } = parse(handleTool(db, "register_agent", { name: "existing-agent" }));
    expect(after_id).toBe(agent_id);
  });
});

// ─── report_blocker ───────────────────────────────────────────────────────────

describe("report_blocker", () => {
  it("reports a blocker on a task and returns blocker_id", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Blocked task", priority: "medium" }));

    const result = handleTool(db, "report_blocker", {
      task_id,
      reason: "Waiting on external API",
    });
    const data = parse(result);
    expect(data.blocker_id).toBeTruthy();

    // Task should now be blocked
    const fetched = parse(handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("blocked");
  });
});

// ─── resolve_blocker ──────────────────────────────────────────────────────────

describe("resolve_blocker", () => {
  it("resolves a blocker, reverts task to in_progress, and returns success", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const { task_id } = parse(handleTool(db, "create_task", { project_id, title: "Blocked task", priority: "medium" }));
    const { blocker_id } = parse(handleTool(db, "report_blocker", { task_id, reason: "API down" }));

    const result = handleTool(db, "resolve_blocker", { blocker_id });
    const data = parse(result);
    expect(data.success).toBe(true);

    // Task should revert to in_progress after blocker is resolved
    const fetched = parse(handleTool(db, "get_task", { task_id }));
    expect(fetched.task.status).toBe("in_progress");
  });
});

// ─── list_projects / list_tasks ───────────────────────────────────────────────

describe("list operations", () => {
  it("list_projects returns all projects", () => {
    handleTool(db, "create_project", { name: "Alpha" });
    handleTool(db, "create_project", { name: "Beta" });

    const result = handleTool(db, "list_projects", {});
    const data = parse(result);
    expect(data.projects).toHaveLength(2);
    expect(data.projects.map((p: { name: string }) => p.name)).toContain("Alpha");
  });

  it("list_projects excludes archived projects by default", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "Alpha" }));
    handleTool(db, "create_project", { name: "Beta" });
    handleTool(db, "archive_project", { project_id });

    const result = handleTool(db, "list_projects", {});
    const data = parse(result);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].name).toBe("Beta");
  });

  it("list_projects includes archived projects when include_archived is true", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "Alpha" }));
    handleTool(db, "archive_project", { project_id });

    const result = handleTool(db, "list_projects", { include_archived: true });
    const data = parse(result);
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0].archived_at).not.toBeNull();
  });

  it("list_tasks returns tasks with filters", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P" }));
    handleTool(db, "create_task", { project_id, title: "Task 1", priority: "low" });
    handleTool(db, "create_task", { project_id, title: "Task 2", priority: "low" });

    const result = handleTool(db, "list_tasks", { project_id });
    const data = parse(result);
    expect(data.tasks).toHaveLength(2);
  });
});

// ─── archive_project / unarchive_project ───────────────────────────────────────

describe("archive_project / unarchive_project", () => {
  it("archives a project", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const result = handleTool(db, "archive_project", { project_id });
    expect(parse(result).success).toBe(true);

    const listed = parse(handleTool(db, "list_projects", {}));
    expect(listed.projects).toHaveLength(0);
  });

  it("returns success=false for an unknown project", () => {
    const result = handleTool(db, "archive_project", { project_id: "no-such-id" });
    const data = parse(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeTruthy();
  });

  it("is idempotent: archiving an already-archived project succeeds without a duplicate broadcast", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    handleTool(db, "archive_project", { project_id });
    vi.mocked(broadcast).mockClear();
    const result = handleTool(db, "archive_project", { project_id });
    expect(parse(result).success).toBe(true);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("unarchive_project restores a project to the default list", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    handleTool(db, "archive_project", { project_id });

    const result = handleTool(db, "unarchive_project", { project_id });
    expect(parse(result).success).toBe(true);

    const listed = parse(handleTool(db, "list_projects", {}));
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0].archived_at).toBeNull();
  });

  it("unarchive_project returns success=false for an unknown project", () => {
    const result = handleTool(db, "unarchive_project", { project_id: "no-such-id" });
    expect(parse(result).success).toBe(false);
  });
});

// ─── search_tasks ─────────────────────────────────────────────────────────────

describe("search_tasks", () => {
  it("returns tasks matching query", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    handleTool(db, "create_task", { project_id, title: "Implement auth", priority: "high" });
    handleTool(db, "create_task", { project_id, title: "Write tests", priority: "low" });

    const result = handleTool(db, "search_tasks", { query: "auth" });
    const data = parse(result);
    expect(data.tasks.length).toBeGreaterThanOrEqual(1);
    expect(data.tasks.some((t: { title: string }) => t.title.includes("auth"))).toBe(true);
  });
});

// ─── list_milestones / complete_milestone ─────────────────────────────────────

describe("milestones", () => {
  it("list_milestones returns empty when none exist", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "P1" }));
    const result = handleTool(db, "list_milestones", { project_id });
    const data = parse(result);
    expect(data.milestones).toEqual([]);
  });

  it("complete_milestone returns success=false for unknown id", () => {
    const result = handleTool(db, "complete_milestone", { milestone_id: "no-such-id" });
    const data = parse(result);
    expect(data.success).toBe(false);
  });
});

// ─── onboarding wizard flow ───────────────────────────────────────────────────

describe("onboarding wizard flow", () => {
  it("supports full wizard path: project → task", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "My First Project", description: "Onboarding test" }));
    expect(project_id).toBeTruthy();

    const { task_id } = parse(handleTool(db, "create_task", {
      project_id,
      title: "My first task",
      description: "Created during onboarding",
      priority: "medium",
    }));
    expect(task_id).toBeTruthy();

    const fetched = parse(handleTool(db, "get_task", { task_id }));
    expect(fetched.task.project_id).toBe(project_id);
    expect(fetched.task.status).toBe("planned");
  });

  it("supports demo project seeding: multiple tasks in varied states", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "Demo Project" }));

    const demoTasks = [
      { title: "Task A", priority: "high" },
      { title: "Task B", priority: "medium" },
      { title: "Task C", priority: "low" },
    ];

    const taskIds: string[] = [];
    for (const t of demoTasks) {
      const { task_id } = parse(handleTool(db, "create_task", { project_id, ...t }));
      taskIds.push(task_id);
    }

    // Update statuses to simulate a realistic board
    handleTool(db, "update_task", { task_id: taskIds[0], status: "done", progress: 100 });
    handleTool(db, "update_task", { task_id: taskIds[1], status: "in_progress", progress: 50 });

    // Default list_tasks hides finished work so an agent sees only actionable tasks.
    const listed = parse(handleTool(db, "list_tasks", { project_id }));
    expect(listed.tasks).toHaveLength(2);
    const statuses = listed.tasks.map((t: { status: string }) => t.status);
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("planned");
    expect(statuses).not.toContain("done");

    // An explicit status filter still surfaces completed tasks.
    const doneList = parse(handleTool(db, "list_tasks", { project_id, status: "done" }));
    expect(doneList.tasks).toHaveLength(1);
    expect(doneList.tasks[0].status).toBe("done");
  });
});

// ─── list_tasks pagination + default status filter ────────────────────────────

describe("list_tasks pagination + defaults", () => {
  function seed(count: number) {
    const { project_id } = parse(handleTool(db, "create_project", { name: "Big" }));
    for (let i = 0; i < count; i++) {
      handleTool(db, "create_task", { project_id, title: `Task ${i}`, priority: "low" });
    }
    return project_id;
  }

  it("caps the response at the default limit (200) and reports has_more", () => {
    const project_id = seed(250);
    const data = parse(handleTool(db, "list_tasks", { project_id }));
    expect(data.tasks).toHaveLength(200);
    expect(data.total).toBe(250);
    expect(data.has_more).toBe(true);
    expect(data.next_offset).toBe(200);
  });

  it("honors limit + offset and clears has_more on the last page", () => {
    const project_id = seed(10);
    const page1 = parse(handleTool(db, "list_tasks", { project_id, limit: 4 }));
    expect(page1.tasks).toHaveLength(4);
    expect(page1.has_more).toBe(true);
    expect(page1.next_offset).toBe(4);

    const lastPage = parse(handleTool(db, "list_tasks", { project_id, limit: 4, offset: 8 }));
    expect(lastPage.tasks).toHaveLength(2);
    expect(lastPage.has_more).toBe(false);
    expect(lastPage.next_offset).toBeNull();
  });

  it("clamps an oversized limit to the maximum (500)", () => {
    const project_id = seed(50);
    const data = parse(handleTool(db, "list_tasks", { project_id, limit: 100000 }));
    // Only 50 exist, but the clamp means an absurd limit never returns unbounded rows.
    expect(data.tasks).toHaveLength(50);
    expect(data.has_more).toBe(false);
  });

  it("excludes done/cancelled by default but includes them on explicit status", () => {
    const { project_id } = parse(handleTool(db, "create_project", { name: "Mixed" }));
    for (const s of ["planned", "in_progress", "done", "cancelled"]) {
      const { task_id } = parse(handleTool(db, "create_task", { project_id, title: s, priority: "low" }));
      if (s !== "planned") handleTool(db, "update_task", { task_id, status: s });
    }

    const def = parse(handleTool(db, "list_tasks", { project_id }));
    expect(def.total).toBe(2);
    expect(def.tasks.map((t: { status: string }) => t.status).sort()).toEqual(["in_progress", "planned"]);

    const cancelled = parse(handleTool(db, "list_tasks", { project_id, status: "cancelled" }));
    expect(cancelled.tasks).toHaveLength(1);
    expect(cancelled.tasks[0].status).toBe("cancelled");
  });
});

// ─── error handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  it("throws on unknown tool name", () => {
    expect(() => handleTool(db, "unknown_tool", {})).toThrow("Unknown tool: unknown_tool");
  });
});

// ─── advertised MCP surface (regression guard) ────────────────────────────────
//
// Guards against accidental removal of milestone CRUD from the MCP tool list.
// History: commit 6d39d0c cut milestone CRUD; 0c46e35 restored it. Without this
// test, a future cut leaves callers (agents) unable to create milestones and
// the regression is silent until someone notices the tool list mismatch.

describe("advertised MCP tool surface", () => {
  function registeredToolNames(): string[] {
    const handle = createMcpServer(db);
    const tools = (handle.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    return Object.keys(tools);
  }

  it("exposes milestone lifecycle tools", () => {
    const names = registeredToolNames();
    expect(names).toContain("create_milestone");
    expect(names).toContain("list_milestones");
    expect(names).toContain("complete_milestone");
  });

  it("exposes project archive lifecycle tools", () => {
    const names = registeredToolNames();
    expect(names).toContain("archive_project");
    expect(names).toContain("unarchive_project");
  });
});
