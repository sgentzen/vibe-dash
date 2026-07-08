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

  server.registerTool(
    "register_agent",
    {
      description: "Register or update an AI agent",
      inputSchema: registerAgentSchema.shape,
    },
    call("register_agent")
  );

  server.registerTool(
    "list_projects",
    {
      description: "List all projects",
      inputSchema: {},
    },
    call("list_projects")
  );

  server.registerTool(
    "create_milestone",
    {
      description: "Create a milestone for a project",
      inputSchema: createMilestoneSchema.shape,
    },
    call("create_milestone")
  );

  server.registerTool(
    "list_milestones",
    {
      description: "List milestones, optionally filtered by project",
      inputSchema: {
        project_id: z.string().optional(),
      },
    },
    call("list_milestones")
  );

  server.registerTool(
    "complete_milestone",
    {
      description: "Mark a milestone as achieved",
      inputSchema: {
        milestone_id: z.string(),
      },
    },
    call("complete_milestone")
  );

  server.registerTool(
    "create_task",
    {
      description: "Create a new task in a project",
      inputSchema: // Shared schema is stricter (priority required); allow optional here for back-compat
      { ...createTaskSchema.shape, priority: taskPrioritySchema.optional() },
    },
    call("create_task")
  );

  server.registerTool(
    "get_task",
    {
      description: "Get a task by ID",
      inputSchema: {
        task_id: z.string(),
      },
    },
    call("get_task")
  );

  server.registerTool(
    "list_tasks",
    {
      description: "List tasks with optional filters. Excludes done/cancelled by default (pass an explicit status to include them). Paginated: returns up to `limit` (default 200, max 500) tasks from `offset`; check `has_more`/`next_offset` to page.",
      inputSchema: {
        project_id: z.string().optional(),
        status: taskStatusEnum.optional(),
        parent_task_id: z.string().optional(),
        assigned_agent_id: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    call("list_tasks")
  );

  server.registerTool(
    "search_tasks",
    {
      description: "Search tasks with filters",
      inputSchema: {
        query: z.string().optional(),
        project_id: z.string().optional(),
        milestone_id: z.string().optional(),
        status: taskStatusEnum.optional(),
        priority: taskPrioritySchema.optional(),
        assigned_agent_id: z.string().optional(),
        due_before: z.string().optional(),
        due_after: z.string().optional(),
      },
    },
    call("search_tasks")
  );

  server.registerTool(
    "update_task",
    {
      description: "Update task fields",
      inputSchema: {
        task_id: z.string(),
        ...updateTaskSchema.shape,
      },
    },
    call("update_task")
  );

  server.registerTool(
    "complete_task",
    {
      description: "Mark a task as done with 100% progress",
      inputSchema: {
        task_id: z.string(),
        agent_name: z.string().optional(),
      },
    },
    call("complete_task")
  );

  server.registerTool(
    "log_activity",
    {
      description: "Log an activity entry for a task",
      inputSchema: {
        task_id: z.string(),
        agent_name: z.string().optional(),
        message: z.string(),
      },
    },
    call("log_activity")
  );

  server.registerTool(
    "report_blocker",
    {
      description: "Report a blocker on a task",
      inputSchema: {
        task_id: z.string(),
        reason: z.string(),
      },
    },
    call("report_blocker")
  );

  server.registerTool(
    "resolve_blocker",
    {
      description: "Resolve a blocker",
      inputSchema: {
        blocker_id: z.string(),
      },
    },
    call("resolve_blocker")
  );

  server.registerTool(
    "log_cost",
    {
      description: "Log a cost/token usage entry for an LLM call",
      inputSchema: {
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
    },
    call("log_cost")
  );

  server.registerTool(
    "heartbeat",
    {
      description: "Report what you're working on right now (a short freeform status)",
      inputSchema: { status: z.string().min(1).max(280) },
    },
    call("heartbeat")
  );

  server.registerTool(
    "get_project_context",
    {
      description: "Get a project's current state in one call: open milestones (with progress), in-progress tasks, active blockers, and recent activity",
      inputSchema: { project_id: z.string().min(1) },
    },
    call("get_project_context")
  );

  return { server, cleanup };
}
