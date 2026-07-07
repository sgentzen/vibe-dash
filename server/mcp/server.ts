import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type Database from "better-sqlite3";
import { handleTool } from "./tools.js";
import { registerAgent, touchAgent, startOrGetSession, closeAgentSessions, closeStaleSession, cleanupStaleAgents } from "../db/index.js";
import { broadcast } from "../websocket.js";
import {
  taskStatusEnum,
  taskPrioritySchema,
  registerAgentSchema,
  createTaskSchema,
  updateTaskSchema,
  createMilestoneSchema,
} from "../../shared/schemas.js";

export interface McpServerHandle {
  server: McpServer;
  /** Call on transport close to end the agent session */
  cleanup: () => void;
}

export function createMcpServer(db: Database.Database, connectionId?: string): McpServerHandle {
  const server = new McpServer({ name: "vibe-dash", version: "0.1.0" });

  // Connection-unique suffix so each MCP client gets its own agent record
  const suffix = connectionId ? connectionId.slice(0, 8) : randomUUID().slice(0, 8);
  let agentName: string | undefined;
  let agentId: string | undefined;

  // Register the MCP client as an agent as soon as it connects
  server.server.oninitialized = () => {
    // Housekeeping: close stale sessions and remove orphaned agents
    closeStaleSession(db);
    cleanupStaleAgents(db);

    const info = server.server.getClientVersion();
    if (info) {
      agentName = `${info.name}-${suffix}`;
      const agent = registerAgent(db, {
        name: agentName,
        model: info.version ? `${info.name}/${info.version}` : null,
        capabilities: [],
      });
      agentId = agent.id;
      startOrGetSession(db, agent.id);
      broadcast({ type: "agent_registered", payload: agent });
    }
  };

  function call(toolName: string) {
    return async (args: Record<string, unknown>) => {
      // Touch agent on every tool call to keep last_seen_at fresh
      if (agentName) {
        touchAgent(db, agentName);
      }
      if (agentId) {
        startOrGetSession(db, agentId);
      }
      return handleTool(db, toolName, args, agentName);
    };
  }

  function cleanup() {
    if (agentId) {
      closeAgentSessions(db, agentId);
    }
  }

  server.tool(
    "register_agent",
    "Register or update an AI agent",
    registerAgentSchema.shape,
    call("register_agent")
  );

  server.tool(
    "list_projects",
    "List all projects",
    {},
    call("list_projects")
  );

  server.tool(
    "create_milestone",
    "Create a milestone for a project",
    createMilestoneSchema.shape,
    call("create_milestone")
  );

  server.tool(
    "list_milestones",
    "List milestones, optionally filtered by project",
    {
      project_id: z.string().optional(),
    },
    call("list_milestones")
  );

  server.tool(
    "complete_milestone",
    "Mark a milestone as achieved",
    {
      milestone_id: z.string(),
    },
    call("complete_milestone")
  );

  server.tool(
    "create_task",
    "Create a new task in a project",
    // Shared schema is stricter (priority required); allow optional here for back-compat
    { ...createTaskSchema.shape, priority: taskPrioritySchema.optional() },
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
    "List tasks with optional filters. Excludes done/cancelled by default (pass an explicit status to include them). Paginated: returns up to `limit` (default 200, max 500) tasks from `offset`; check `has_more`/`next_offset` to page.",
    {
      project_id: z.string().optional(),
      status: taskStatusEnum.optional(),
      parent_task_id: z.string().optional(),
      assigned_agent_id: z.string().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    },
    call("list_tasks")
  );

  server.tool(
    "search_tasks",
    "Search tasks with filters",
    {
      query: z.string().optional(),
      project_id: z.string().optional(),
      milestone_id: z.string().optional(),
      status: taskStatusEnum.optional(),
      priority: taskPrioritySchema.optional(),
      assigned_agent_id: z.string().optional(),
      tag_id: z.string().optional(),
      due_before: z.string().optional(),
      due_after: z.string().optional(),
    },
    call("search_tasks")
  );

  server.tool(
    "update_task",
    "Update task fields",
    {
      task_id: z.string(),
      ...updateTaskSchema.shape,
    },
    call("update_task")
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
    "log_cost",
    "Log a cost/token usage entry for an LLM call",
    {
      model: z.string(),
      provider: z.string(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      cost_usd: z.number(),
      agent_id: z.string().optional(),
      task_id: z.string().optional(),
      milestone_id: z.string().optional(),
      project_id: z.string().optional(),
    },
    call("log_cost")
  );

  server.tool(
    "heartbeat",
    "Report what you're working on right now (a short freeform status)",
    { status: z.string().min(1).max(280) },
    call("heartbeat")
  );

  server.tool(
    "get_project_context",
    "Get a project's current state in one call: open milestones (with progress), in-progress tasks, active blockers, and recent activity",
    { project_id: z.string().min(1) },
    call("get_project_context")
  );

  return { server, cleanup };
}
