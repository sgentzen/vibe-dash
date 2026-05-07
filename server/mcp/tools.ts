import type Database from "better-sqlite3";
import {
  registerAgent,
  createProject,
  listProjects,
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  logActivity,
  createBlocker,
  resolveBlocker,
  resolveBlockersForTask,
  touchAgent,
  listMilestones,
  completeMilestone,
  searchTasks,
  handleRecurringTaskCompletion,
  recordMilestoneDailyStats,
  logCost,
} from "../db/index.js";
import { registerAgentSchema } from "../../shared/schemas.js";
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

export async function handleTool(
  db: Database.Database,
  toolName: string,
  args: Record<string, unknown>,
  defaultAgentName?: string
): Promise<ToolResult> {
  // Use the MCP client identity as fallback when agent_name is not provided
  const agentName = (args.agent_name as string | undefined) ?? defaultAgentName;
  switch (toolName) {
    case "register_agent": {
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

    case "create_project": {
      const project = createProject(db, {
        name: args.name as string,
        description: (args.description as string | undefined) ?? null,
      });
      broadcast({ type: "project_created", payload: project });
      return ok({ project_id: project.id });
    }

    case "list_projects": {
      const projects = listProjects(db);
      return ok({ projects });
    }

    case "list_milestones": {
      const milestones = listMilestones(db, args.project_id as string | undefined);
      return ok({ milestones });
    }

    case "complete_milestone": {
      const completed = completeMilestone(db, args.milestone_id as string);
      if (completed) {
        broadcast({ type: "milestone_achieved", payload: completed });
      }
      return ok({ success: completed !== null });
    }

    case "create_task": {
      const task = createTask(db, {
        project_id: args.project_id as string,
        parent_task_id: (args.parent_task_id as string | undefined) ?? null,
        milestone_id: (args.milestone_id as string | undefined) ?? null,
        title: args.title as string,
        description: (args.description as string | undefined) ?? null,
        priority: (args.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
        status: (args.status as "planned" | "in_progress" | "blocked" | "done" | undefined) ?? "planned",
      });
      broadcast({ type: "task_created", payload: task });
      autoLog(db, task.id, `Created task: ${task.title}`, agentName);
      return ok({ task_id: task.id });
    }

    case "get_task": {
      const task = getTask(db, args.task_id as string);
      return ok({ task });
    }

    case "list_tasks": {
      const tasks = listTasks(db, {
        project_id: args.project_id as string | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        parent_task_id: args.parent_task_id as string | undefined,
        assigned_agent_id: args.assigned_agent_id as string | undefined,
      });
      return ok({ tasks });
    }

    case "search_tasks": {
      const results = searchTasks(db, {
        query: args.query as string | undefined,
        project_id: args.project_id as string | undefined,
        milestone_id: args.milestone_id as string | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        assigned_agent_id: args.assigned_agent_id as string | undefined,
        tag_id: args.tag_id as string | undefined,
        due_before: args.due_before as string | undefined,
        due_after: args.due_after as string | undefined,
      });
      return ok({ tasks: results });
    }

    case "update_task": {
      const prior = getTask(db, args.task_id as string);
      const updated = updateTask(db, args.task_id as string, {
        title: args.title as string | undefined,
        description: args.description as string | null | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        progress: args.progress as number | undefined,
        parent_task_id: args.parent_task_id as string | null | undefined,
        milestone_id: args.milestone_id as string | null | undefined,
        assigned_agent_id: args.assigned_agent_id as string | null | undefined,
        due_date: args.due_date as string | null | undefined,
        estimate: args.estimate as number | null | undefined,
      });
      if (updated) {
        // Auto-assign agent when status changes to in_progress or done
        if (agentName && !updated.assigned_agent_id && args.status && (args.status === "in_progress" || args.status === "done")) {
          const agent = touchAgent(db, agentName);
          updateTask(db, updated.id, { assigned_agent_id: agent.id });
        }
        broadcast({ type: "task_updated", payload: updated });
        if (args.status && prior && args.status !== prior.status && (args.status === "done" || prior.status === "blocked")) {
          for (const b of resolveBlockersForTask(db, updated.id)) {
            broadcast({ type: "blocker_resolved", payload: b });
          }
        }
        const changes: string[] = [];
        if (args.status) changes.push(`status → ${args.status}`);
        if (args.progress !== undefined) changes.push(`progress → ${args.progress}%`);
        if (args.title) changes.push(`title → "${args.title}"`);
        const msg = changes.length > 0
          ? `Updated "${updated.title}": ${changes.join(", ")}`
          : `Updated "${updated.title}"`;
        autoLog(db, updated.id, msg, agentName);
        // Record milestone daily stats when status changes
        if (args.status && prior && args.status !== prior.status && updated.milestone_id) {
          recordMilestoneDailyStats(db, updated.milestone_id);
        }
      }
      return ok({ success: true });
    }

    case "complete_task": {
      // Auto-assign agent before completion if not already assigned
      if (agentName) {
        const task = getTask(db, args.task_id as string);
        if (task && !task.assigned_agent_id) {
          const agent = touchAgent(db, agentName);
          updateTask(db, task.id, { assigned_agent_id: agent.id });
        }
      }
      const completed = completeTask(db, args.task_id as string);
      if (completed) {
        broadcast({ type: "task_completed", payload: completed });
        for (const b of resolveBlockersForTask(db, completed.id)) {
          broadcast({ type: "blocker_resolved", payload: b });
        }
        autoLog(db, completed.id, `Completed "${completed.title}"`, agentName);
        // Record milestone daily stats
        if (completed.milestone_id) {
          recordMilestoneDailyStats(db, completed.milestone_id);
        }
        // Handle recurring tasks
        const nextTask = handleRecurringTaskCompletion(db, completed.id);
        if (nextTask) {
          broadcast({ type: "task_created", payload: nextTask });
        }
      }
      return ok({ success: true });
    }

    case "log_activity": {
      autoLog(db, args.task_id as string, args.message as string, agentName);
      return ok({ success: true });
    }

    case "report_blocker": {
      const blocker = createBlocker(db, {
        task_id: args.task_id as string,
        reason: args.reason as string,
      });
      const task = getTask(db, args.task_id as string);
      broadcast({ type: "blocker_reported", payload: blocker });
      if (task) {
        broadcast({ type: "task_updated", payload: task });
      }
      autoLog(db, blocker.task_id, `Blocker reported: ${blocker.reason}`, agentName);
      return ok({ blocker_id: blocker.id });
    }

    case "resolve_blocker": {
      const blocker = resolveBlocker(db, args.blocker_id as string);
      if (blocker) {
        broadcast({ type: "blocker_resolved", payload: blocker });
        autoLog(db, blocker.task_id, `Blocker resolved: ${blocker.reason}`, agentName);
      }
      return ok({ success: true });
    }

    case "log_cost": {
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

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
