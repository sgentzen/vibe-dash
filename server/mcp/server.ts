import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import { handleTool } from "./tools.js";

const STATUS_ENUM = z.enum(["planned", "in_progress", "blocked", "done"]);
const PRIORITY_ENUM = z.enum(["low", "medium", "high", "urgent"]);

export function createMcpServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: "vibe-dash", version: "0.1.0" });

  server.tool(
    "register_agent",
    "Register or update an AI agent",
    {
      name: z.string(),
      model: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
    },
    async (args) => handleTool(db, "register_agent", args)
  );

  server.tool(
    "create_project",
    "Create a new project",
    {
      name: z.string(),
      description: z.string().optional(),
    },
    async (args) => handleTool(db, "create_project", args)
  );

  server.tool(
    "list_projects",
    "List all projects",
    {},
    async (args) => handleTool(db, "list_projects", args)
  );

  server.tool(
    "create_task",
    "Create a new task in a project",
    {
      project_id: z.string(),
      parent_task_id: z.string().optional(),
      title: z.string(),
      description: z.string().optional(),
      status: STATUS_ENUM.optional(),
      priority: PRIORITY_ENUM.optional(),
    },
    async (args) => handleTool(db, "create_task", args)
  );

  server.tool(
    "get_task",
    "Get a task by ID",
    {
      task_id: z.string(),
    },
    async (args) => handleTool(db, "get_task", args)
  );

  server.tool(
    "list_tasks",
    "List tasks with optional filters",
    {
      project_id: z.string().optional(),
      status: STATUS_ENUM.optional(),
      parent_task_id: z.string().optional(),
    },
    async (args) => handleTool(db, "list_tasks", args)
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
    },
    async (args) => handleTool(db, "update_task", args)
  );

  server.tool(
    "complete_task",
    "Mark a task as done with 100% progress",
    {
      task_id: z.string(),
    },
    async (args) => handleTool(db, "complete_task", args)
  );

  server.tool(
    "log_activity",
    "Log an activity entry for a task, auto-registering the agent if needed",
    {
      task_id: z.string(),
      agent_name: z.string().optional(),
      message: z.string(),
    },
    async (args) => handleTool(db, "log_activity", args)
  );

  server.tool(
    "report_blocker",
    "Report a blocker on a task",
    {
      task_id: z.string(),
      reason: z.string(),
    },
    async (args) => handleTool(db, "report_blocker", args)
  );

  server.tool(
    "resolve_blocker",
    "Resolve a blocker",
    {
      blocker_id: z.string(),
    },
    async (args) => handleTool(db, "resolve_blocker", args)
  );

  return server;
}
