import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type Database from "better-sqlite3";
import { handleTool } from "./tools.js";
import { registerAgent, touchAgent, startOrGetSession, closeAgentSessions, closeStaleSession, cleanupStaleAgents } from "../db/index.js";
import { broadcast } from "../websocket.js";
import {
  taskStatusEnum as STATUS_ENUM,
  taskPrioritySchema as PRIORITY_ENUM,
  milestoneStatusEnum as MILESTONE_STATUS_ENUM,
  registerAgentSchema,
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  createMilestoneSchema,
  updateMilestoneSchema,
} from "../../shared/schemas.js";

export interface McpServerHandle {
  server: McpServer;
  /** Call on transport close to end the agent session */
  cleanup: () => void;
}

export function createMcpServer(db: Database.Database, connectionId?: string): McpServerHandle {
  const server = new McpServer({ name: "vibe-dash", version: "0.1.0" });

  // Connection-unique suffix so each MCP client gets its own agent record
  const suffix = connectionId ? connectionId.slice(0, 8) : Math.random().toString(36).slice(2, 10);
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
    "create_project",
    "Create a new project",
    createProjectSchema.shape,
    call("create_project")
  );

  server.tool(
    "update_project",
    "Update an existing project's name or description",
    {
      project_id: z.string(),
      ...updateProjectSchema.shape,
    },
    call("update_project")
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
    // Shared schema is stricter (priority required); allow optional here for back-compat
    { ...createTaskSchema.shape, priority: PRIORITY_ENUM.optional() },
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
      ...updateTaskSchema.shape,
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
    "update_milestone",
    "Update milestone fields",
    {
      milestone_id: z.string(),
      ...updateMilestoneSchema.shape,
    },
    call("update_milestone")
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

  // ─── R2: Dependencies ──────────────────────────────────────────────────────

  server.tool(
    "add_dependency",
    "Add a blocking dependency between tasks",
    {
      task_id: z.string(),
      depends_on_task_id: z.string(),
    },
    call("add_dependency")
  );

  server.tool(
    "remove_dependency",
    "Remove a task dependency",
    {
      dependency_id: z.string(),
    },
    call("remove_dependency")
  );

  server.tool(
    "list_dependencies",
    "List dependencies for a task",
    {
      task_id: z.string(),
    },
    call("list_dependencies")
  );

  // ─── R2: Agent Sessions ────────────────────────────────────────────────────

  server.tool(
    "list_agent_sessions",
    "List sessions for an agent",
    {
      agent_id: z.string(),
    },
    call("list_agent_sessions")
  );

  // ─── R2: Search ────────────────────────────────────────────────────────────

  server.tool(
    "search_tasks",
    "Search tasks with filters",
    {
      query: z.string().optional(),
      project_id: z.string().optional(),
      milestone_id: z.string().optional(),
      status: STATUS_ENUM.optional(),
      priority: PRIORITY_ENUM.optional(),
      assigned_agent_id: z.string().optional(),
      tag_id: z.string().optional(),
      due_before: z.string().optional(),
      due_after: z.string().optional(),
    },
    call("search_tasks")
  );

  // ─── R2: Agent Detail ──────────────────────────────────────────────────────

  server.tool(
    "get_agent_detail",
    "Get detailed info about an agent including health, activity, and sessions",
    {
      agent_id: z.string(),
    },
    call("get_agent_detail")
  );

  // ─── R5: Mentions ───────────────────────────────────────────────────

  server.tool(
    "list_mentions",
    "List comments that mention an agent",
    {
      agent_name: z.string(),
    },
    call("list_mentions")
  );

  // ─── R5: Templates ────────────────────────────────────────────────

  server.tool(
    "create_project_from_template",
    "Create a project from a template",
    {
      template_id: z.string(),
      project_name: z.string(),
    },
    call("create_project_from_template")
  );

  server.tool(
    "list_templates",
    "List available project templates",
    {},
    call("list_templates")
  );

  // ─── R4: Agent Stats ─────────────────────────────────────────────────

  server.tool(
    "get_agent_stats",
    "Get performance metrics for an agent",
    {
      agent_id: z.string(),
      milestone_id: z.string().optional(),
    },
    call("get_agent_stats")
  );

  server.tool(
    "generate_report",
    "Generate a markdown status report for a project",
    {
      project_id: z.string(),
      period: z.enum(["day", "week", "milestone"]),
    },
    call("generate_report")
  );

  // ─── R3: Comments ───────────────────────────────────────────────────────

  server.tool(
    "add_comment",
    "Add a comment to a task",
    {
      task_id: z.string(),
      message: z.string(),
      agent_name: z.string(),
      agent_id: z.string().optional(),
    },
    call("add_comment")
  );

  server.tool(
    "list_comments",
    "List comments for a task",
    {
      task_id: z.string(),
    },
    call("list_comments")
  );

  // ─── R3: File Locks ────────────────────────────────────────────────────

  server.tool(
    "report_working_on",
    "Declare files an agent is working on for conflict detection",
    {
      agent_id: z.string(),
      task_id: z.string(),
      file_paths: z.array(z.string()),
    },
    call("report_working_on")
  );

  // ─── R3: Notifications ─────────────────────────────────────────────────

  server.tool(
    "list_notifications",
    "List recent notifications",
    {
      limit: z.number().int().min(1).max(200).optional(),
    },
    call("list_notifications")
  );

  server.tool(
    "mark_notification_read",
    "Mark a notification as read",
    {
      notification_id: z.string(),
    },
    call("mark_notification_read")
  );

  // ─── R3: Bulk Update ───────────────────────────────────────────────────

  server.tool(
    "bulk_update_tasks",
    "Update multiple tasks at once",
    {
      task_ids: z.array(z.string()),
      status: STATUS_ENUM.optional(),
      priority: PRIORITY_ENUM.optional(),
      assigned_agent_id: z.string().nullable().optional(),
    },
    call("bulk_update_tasks")
  );

  // ─── Cost & Token Tracking ────────────────────────────────────────────

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
    "get_cost_summary",
    "Get cost summary for an agent, milestone, or project",
    {
      agent_id: z.string().optional(),
      milestone_id: z.string().optional(),
      project_id: z.string().optional(),
    },
    call("get_cost_summary")
  );

  server.tool(
    "get_cost_timeseries",
    "Get daily cost timeseries data",
    {
      agent_id: z.string().optional(),
      milestone_id: z.string().optional(),
      project_id: z.string().optional(),
      days: z.number().optional(),
    },
    call("get_cost_timeseries")
  );

  server.tool(
    "get_cost_by_model",
    "Get cost breakdown by model",
    {
      project_id: z.string().optional(),
      milestone_id: z.string().optional(),
    },
    call("get_cost_by_model")
  );

  server.tool(
    "get_cost_by_agent",
    "Get cost breakdown by agent",
    {
      project_id: z.string().optional(),
      milestone_id: z.string().optional(),
    },
    call("get_cost_by_agent")
  );

  // ─── Agent Performance Metrics ──────────────────────────────────────────

  server.tool(
    "log_completion_metrics",
    "Log completion metrics for a task (lines changed, files, tests, duration)",
    {
      task_id: z.string(),
      agent_id: z.string(),
      lines_added: z.number().optional(),
      lines_removed: z.number().optional(),
      files_changed: z.number().optional(),
      tests_added: z.number().optional(),
      tests_passing: z.number().optional(),
      duration_seconds: z.number().optional(),
    },
    call("log_completion_metrics")
  );

  server.tool(
    "get_agent_comparison",
    "Compare performance metrics across all agents",
    {},
    call("get_agent_comparison")
  );

  server.tool(
    "get_agent_performance",
    "Get detailed performance metrics for a specific agent",
    {
      agent_id: z.string(),
    },
    call("get_agent_performance")
  );

  server.tool(
    "get_task_type_breakdown",
    "Get task type breakdown for a specific agent",
    {
      agent_id: z.string(),
    },
    call("get_task_type_breakdown")
  );

  // ─── 5.4: Code Review ──────────────────────────────────────────────────

  const reviewStatus = z.enum(["pending", "approved", "changes_requested"]);

  server.tool(
    "create_review",
    "Create a code review for a task (diff summary, status, comments)",
    {
      task_id: z.string(),
      reviewer_name: z.string().optional(),
      reviewer_agent_id: z.string().optional(),
      status: reviewStatus.optional(),
      comments: z.string().optional(),
      diff_summary: z.string().optional(),
    },
    call("create_review")
  );

  server.tool(
    "list_reviews",
    "List reviews for a task",
    { task_id: z.string() },
    call("list_reviews")
  );

  server.tool(
    "update_review",
    "Update a review's status, comments, or diff summary",
    {
      review_id: z.string(),
      status: reviewStatus.optional(),
      comments: z.string().optional(),
      diff_summary: z.string().optional(),
    },
    call("update_review")
  );

  return { server, cleanup };
}
