import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import { handleTool } from "./tools.js";
import { registerAgent } from "../db.js";
import { broadcast } from "../websocket.js";

const STATUS_ENUM = z.enum(["planned", "in_progress", "blocked", "done"]);
const PRIORITY_ENUM = z.enum(["low", "medium", "high", "urgent"]);
const SPRINT_STATUS_ENUM = z.enum(["planned", "active", "completed"]);

export function createMcpServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: "vibe-dash", version: "0.1.0" });

  // Register the MCP client as an agent as soon as it connects
  server.server.oninitialized = () => {
    const info = server.server.getClientVersion();
    if (info) {
      const agent = registerAgent(db, {
        name: info.name,
        model: info.version ? `${info.name}/${info.version}` : null,
        capabilities: [],
      });
      broadcast({ type: "agent_registered", payload: agent });
    }
  };

  /** Resolve connected MCP client name for automatic agent registration */
  function clientName(): string | undefined {
    return server.server.getClientVersion()?.name;
  }

  function call(toolName: string) {
    return async (args: Record<string, unknown>) =>
      handleTool(db, toolName, args, clientName());
  }

  server.tool(
    "register_agent",
    "Register or update an AI agent",
    {
      name: z.string(),
      model: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
    },
    call("register_agent")
  );

  server.tool(
    "create_project",
    "Create a new project",
    {
      name: z.string(),
      description: z.string().optional(),
    },
    call("create_project")
  );

  server.tool(
    "list_projects",
    "List all projects",
    {},
    call("list_projects")
  );

  server.tool(
    "create_task",
    "Create a new task in a project",
    {
      project_id: z.string(),
      parent_task_id: z.string().optional(),
      sprint_id: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      status: STATUS_ENUM.optional(),
      priority: PRIORITY_ENUM.optional(),
      agent_name: z.string().optional(),
    },
    call("create_task")
  );

  server.tool(
    "get_task",
    "Get a task by ID",
    {
      task_id: z.string(),
    },
    call("get_task")
  );

  server.tool(
    "list_tasks",
    "List tasks with optional filters",
    {
      project_id: z.string().optional(),
      status: STATUS_ENUM.optional(),
      parent_task_id: z.string().optional(),
      assigned_agent_id: z.string().optional(),
    },
    call("list_tasks")
  );

  server.tool(
    "update_task",
    "Update task fields",
    {
      task_id: z.string(),
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      status: STATUS_ENUM.optional(),
      priority: PRIORITY_ENUM.optional(),
      progress: z.number().min(0).max(100).optional(),
      parent_task_id: z.string().nullable().optional(),
      sprint_id: z.string().nullable().optional(),
      assigned_agent_id: z.string().nullable().optional(),
      due_date: z.string().nullable().optional(),
      agent_name: z.string().optional(),
    },
    call("update_task")
  );

  server.tool(
    "assign_task",
    "Assign a task to an agent",
    {
      task_id: z.string(),
      agent_id: z.string(),
      agent_name: z.string().optional(),
    },
    call("assign_task")
  );

  server.tool(
    "unassign_task",
    "Remove agent assignment from a task",
    {
      task_id: z.string(),
      agent_name: z.string().optional(),
    },
    call("unassign_task")
  );

  server.tool(
    "complete_task",
    "Mark a task as done with 100% progress",
    {
      task_id: z.string(),
      agent_name: z.string().optional(),
    },
    call("complete_task")
  );

  server.tool(
    "log_activity",
    "Log an activity entry for a task",
    {
      task_id: z.string(),
      agent_name: z.string().optional(),
      message: z.string(),
    },
    call("log_activity")
  );

  server.tool(
    "report_blocker",
    "Report a blocker on a task",
    {
      task_id: z.string(),
      reason: z.string(),
    },
    call("report_blocker")
  );

  server.tool(
    "resolve_blocker",
    "Resolve a blocker",
    {
      blocker_id: z.string(),
    },
    call("resolve_blocker")
  );

  server.tool(
    "create_sprint",
    "Create a sprint for a project",
    {
      project_id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      status: SPRINT_STATUS_ENUM.optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional(),
    },
    call("create_sprint")
  );

  server.tool(
    "list_sprints",
    "List sprints, optionally filtered by project",
    {
      project_id: z.string().optional(),
    },
    call("list_sprints")
  );

  server.tool(
    "update_sprint",
    "Update sprint fields",
    {
      sprint_id: z.string(),
      name: z.string().optional(),
      description: z.string().nullable().optional(),
      status: SPRINT_STATUS_ENUM.optional(),
      start_date: z.string().nullable().optional(),
      end_date: z.string().nullable().optional(),
    },
    call("update_sprint")
  );

  server.tool(
    "create_tag",
    "Create a project-scoped tag with a color",
    {
      project_id: z.string(),
      name: z.string(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    },
    call("create_tag")
  );

  server.tool(
    "list_tags",
    "List tags for a project",
    {
      project_id: z.string(),
    },
    call("list_tags")
  );

  server.tool(
    "add_tag",
    "Add a tag to a task",
    {
      task_id: z.string(),
      tag_id: z.string(),
    },
    call("add_tag")
  );

  server.tool(
    "remove_tag",
    "Remove a tag from a task",
    {
      task_id: z.string(),
      tag_id: z.string(),
    },
    call("remove_tag")
  );

  server.tool(
    "get_task_tags",
    "Get all tags for a task",
    {
      task_id: z.string(),
    },
    call("get_task_tags")
  );

  return server;
}
