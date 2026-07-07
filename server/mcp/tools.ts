import type Database from "better-sqlite3";
import {
  registerAgent,
  createProject,
  listProjects,
  createTask,
  getTask,
  listTasks,
  countTasks,
  updateTask,
  completeTask,
  logActivity,
  createBlocker,
  resolveBlocker,
  resolveBlockersForTask,
  touchAgent,
  createMilestone,
  listMilestones,
  completeMilestone,
  searchTasks,
  recordMilestoneDailyStats,
  logCost,
  setAgentStatus,
  getProjectContext,
} from "../db/index.js";
import type { ListTasksFilter } from "../db/index.js";
import { registerAgentSchema } from "../../shared/schemas.js";
import { DEFAULT_TASK_LIST_LIMIT } from "../constants.js";
import { broadcast } from "../websocket.js";

/** Auto-log activity and broadcast it for any mutation */
function autoLog(
  db: Parameters<typeof logActivity>[0],
  taskId: string,
  message: string,
  agentName?: string
): void {
  let agentId: string | null = null;
  if (agentName) {
    const agent = touchAgent(db, agentName);
    broadcast({ type: "agent_registered", payload: agent });
    agentId = agent.id;
  }
  const entry = logActivity(db, { task_id: taskId, agent_id: agentId, message, source: "mcp" });
  const task = getTask(db, taskId);
  broadcast({
    type: "agent_activity",
    payload: {
      ...entry,
      agent_name: agentName ?? null,
      task_title: task?.title ?? null,
    },
  });
}

type ToolResult = { content: [{ type: "text"; text: string }]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

type Args = Record<string, unknown>;
type TaskStatus = "planned" | "in_progress" | "blocked" | "done" | "cancelled";
type Priority = "low" | "medium" | "high" | "urgent";

function handleRegisterAgent(db: Database.Database, args: Args): ToolResult {
  const { name, model, capabilities, role, parent_agent_name } = registerAgentSchema.parse(args);
  const agent = registerAgent(db, {
    name,
    model: model ?? null,
    capabilities: capabilities ?? [],
    role,
    parent_agent_name,
  });
  broadcast({ type: "agent_registered", payload: agent });
  return ok({ agent_id: agent.id });
}

function handleCreateProject(db: Database.Database, args: Args): ToolResult {
  const project = createProject(db, {
    name: args.name as string,
    description: (args.description as string | undefined) ?? null,
  });
  broadcast({ type: "project_created", payload: project });
  return ok({ project_id: project.id });
}

function handleCreateMilestone(db: Database.Database, args: Args): ToolResult {
  const milestone = createMilestone(db, {
    project_id: args.project_id as string,
    name: args.name as string,
    description: (args.description as string | undefined) ?? null,
    acceptance_criteria: (args.acceptance_criteria as string | undefined) ?? null,
    target_date: (args.target_date as string | undefined) ?? null,
  });
  broadcast({ type: "milestone_created", payload: milestone });
  return ok({ milestone_id: milestone.id });
}

function handleCompleteMilestone(db: Database.Database, args: Args): ToolResult {
  const completed = completeMilestone(db, args.milestone_id as string);
  if (completed) broadcast({ type: "milestone_achieved", payload: completed });
  return ok({ success: completed !== null });
}

function handleCreateTask(db: Database.Database, args: Args, agentName?: string): ToolResult {
  const task = createTask(db, {
    project_id: args.project_id as string,
    parent_task_id: (args.parent_task_id as string | undefined) ?? null,
    milestone_id: (args.milestone_id as string | undefined) ?? null,
    title: args.title as string,
    description: (args.description as string | undefined) ?? null,
    priority: (args.priority as Priority) ?? "medium",
    status: (args.status as TaskStatus | undefined) ?? "planned",
  });
  broadcast({ type: "task_created", payload: task });
  autoLog(db, task.id, `Created task: ${task.title}`, agentName);
  return ok({ task_id: task.id });
}

function handleListTasks(db: Database.Database, args: Args): ToolResult {
  // Agent-facing default: hide finished work unless a status is explicitly asked
  // for, and always paginate so a large project can't blow up the agent's context.
  const explicitStatus = args.status as TaskStatus | undefined;
  const filter: ListTasksFilter = {
    project_id: args.project_id as string | undefined,
    status: explicitStatus,
    exclude_statuses: explicitStatus ? undefined : ["done", "cancelled"],
    parent_task_id: args.parent_task_id as string | undefined,
    assigned_agent_id: args.assigned_agent_id as string | undefined,
  };

  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
  const limit = (args.limit as number | undefined) ?? DEFAULT_TASK_LIST_LIMIT;
  const total = countTasks(db, filter);
  const tasks = listTasks(db, { ...filter, limit, offset });
  const has_more = offset + tasks.length < total;

  return ok({
    tasks,
    total,
    returned: tasks.length,
    offset,
    has_more,
    next_offset: has_more ? offset + tasks.length : null,
  });
}

function handleSearchTasks(db: Database.Database, args: Args): ToolResult {
  const results = searchTasks(db, {
    query: args.query as string | undefined,
    project_id: args.project_id as string | undefined,
    milestone_id: args.milestone_id as string | undefined,
    status: args.status as Exclude<TaskStatus, "cancelled"> | undefined,
    priority: args.priority as Priority | undefined,
    assigned_agent_id: args.assigned_agent_id as string | undefined,
    tag_id: args.tag_id as string | undefined,
    due_before: args.due_before as string | undefined,
    due_after: args.due_after as string | undefined,
  });
  return ok({ tasks: results });
}

function autoAssignOnStatusChange(
  db: Database.Database,
  updatedId: string,
  currentAssignedId: string | null,
  agentName: string | undefined,
  newStatus: unknown,
): void {
  if (!agentName || currentAssignedId) return;
  if (newStatus !== "in_progress" && newStatus !== "done") return;
  const agent = touchAgent(db, agentName);
  updateTask(db, updatedId, { assigned_agent_id: agent.id });
}

function buildUpdateMessage(updated: { title: string }, args: Args): string {
  const changes: string[] = [];
  if (args.status) changes.push(`status → ${args.status as string}`);
  if (args.progress !== undefined) changes.push(`progress → ${args.progress as number}%`);
  if (args.title) changes.push(`title → "${args.title as string}"`);
  return changes.length > 0
    ? `Updated "${updated.title}": ${changes.join(", ")}`
    : `Updated "${updated.title}"`;
}

function handleUpdateTask(db: Database.Database, args: Args, agentName?: string): ToolResult {
  const taskId = args.task_id as string;
  const prior = getTask(db, taskId);
  const updated = updateTask(db, taskId, {
    title: args.title as string | undefined,
    description: args.description as string | null | undefined,
    status: args.status as TaskStatus | undefined,
    priority: args.priority as Priority | undefined,
    progress: args.progress as number | undefined,
    parent_task_id: args.parent_task_id as string | null | undefined,
    milestone_id: args.milestone_id as string | null | undefined,
    assigned_agent_id: args.assigned_agent_id as string | null | undefined,
    due_date: args.due_date as string | null | undefined,
    start_date: args.start_date as string | null | undefined,
    estimate: args.estimate as number | null | undefined,
  });
  if (!updated) return ok({ success: true });

  autoAssignOnStatusChange(db, updated.id, updated.assigned_agent_id, agentName, args.status);
  broadcast({ type: "task_updated", payload: updated });

  const statusChanged = Boolean(args.status && prior && args.status !== prior.status);
  if (statusChanged && (args.status === "done" || prior?.status === "blocked")) {
    for (const b of resolveBlockersForTask(db, updated.id)) {
      broadcast({ type: "blocker_resolved", payload: b });
    }
  }
  autoLog(db, updated.id, buildUpdateMessage(updated, args), agentName);
  if (statusChanged && updated.milestone_id) {
    recordMilestoneDailyStats(db, updated.milestone_id);
  }
  return ok({ success: true });
}

function handleCompleteTask(db: Database.Database, args: Args, agentName?: string): ToolResult {
  const taskId = args.task_id as string;
  if (agentName) {
    const task = getTask(db, taskId);
    if (task && !task.assigned_agent_id) {
      const agent = touchAgent(db, agentName);
      updateTask(db, task.id, { assigned_agent_id: agent.id });
    }
  }
  const completed = completeTask(db, taskId);
  if (!completed) return ok({ success: true });

  broadcast({ type: "task_completed", payload: completed });
  for (const b of resolveBlockersForTask(db, completed.id)) {
    broadcast({ type: "blocker_resolved", payload: b });
  }
  autoLog(db, completed.id, `Completed "${completed.title}"`, agentName);
  if (completed.milestone_id) recordMilestoneDailyStats(db, completed.milestone_id);
  return ok({ success: true });
}

function handleReportBlocker(db: Database.Database, args: Args, agentName?: string): ToolResult {
  const blocker = createBlocker(db, {
    task_id: args.task_id as string,
    reason: args.reason as string,
  });
  const task = getTask(db, args.task_id as string);
  broadcast({ type: "blocker_reported", payload: blocker });
  if (task) broadcast({ type: "task_updated", payload: task });
  autoLog(db, blocker.task_id, `Blocker reported: ${blocker.reason}`, agentName);
  return ok({ blocker_id: blocker.id });
}

function handleResolveBlocker(db: Database.Database, args: Args, agentName?: string): ToolResult {
  const blocker = resolveBlocker(db, args.blocker_id as string);
  if (blocker) {
    broadcast({ type: "blocker_resolved", payload: blocker });
    autoLog(db, blocker.task_id, `Blocker resolved: ${blocker.reason}`, agentName);
  }
  return ok({ success: true });
}

function handleLogCost(db: Database.Database, args: Args): ToolResult {
  const entry = logCost(db, {
    agent_id: (args.agent_id as string) ?? null,
    task_id: (args.task_id as string) ?? null,
    milestone_id: (args.milestone_id as string) ?? null,
    project_id: (args.project_id as string) ?? null,
    model: args.model as string,
    provider: args.provider as string,
    input_tokens: args.input_tokens as number,
    output_tokens: args.output_tokens as number,
    cost_usd: args.cost_usd as number,
  });
  return ok(entry);
}

type Handler = (db: Database.Database, args: Args, agentName?: string) => ToolResult;

const HANDLERS: Record<string, Handler> = {
  register_agent: handleRegisterAgent,
  create_project: handleCreateProject,
  list_projects: (db) => ok({ projects: listProjects(db) }),
  create_milestone: handleCreateMilestone,
  list_milestones: (db, args) => ok({ milestones: listMilestones(db, args.project_id as string | undefined) }),
  complete_milestone: handleCompleteMilestone,
  create_task: handleCreateTask,
  get_task: (db, args) => ok({ task: getTask(db, args.task_id as string) }),
  list_tasks: handleListTasks,
  search_tasks: handleSearchTasks,
  update_task: handleUpdateTask,
  complete_task: handleCompleteTask,
  log_activity: (db, args, agentName) => {
    autoLog(db, args.task_id as string, args.message as string, agentName);
    return ok({ success: true });
  },
  report_blocker: handleReportBlocker,
  resolve_blocker: handleResolveBlocker,
  log_cost: handleLogCost,
  heartbeat: (db, args, agentName) => {
    if (agentName) setAgentStatus(db, agentName, args.status as string);
    return ok({ success: true });
  },
  get_project_context: (db, args) => ok(getProjectContext(db, args.project_id as string)),
};

export async function handleTool(
  db: Database.Database,
  toolName: string,
  args: Args,
  defaultAgentName?: string
): Promise<ToolResult> {
  // Use the MCP client identity as fallback when agent_name is not provided
  const agentName = (args.agent_name as string | undefined) ?? defaultAgentName;
  const handler = HANDLERS[toolName];
  if (!handler) throw new Error(`Unknown tool: ${toolName}`);
  return handler(db, args, agentName);
}
