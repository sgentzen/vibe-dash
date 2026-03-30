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
  touchAgent,
  createSprint,
  listSprints,
  updateSprint,
  createTag,
  listTags,
  addTagToTask,
  removeTagFromTask,
  getTaskTags,
} from "../db.js";

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
  const entry = logActivity(db, { task_id: taskId, agent_id: agentId, message });
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

type ToolResult = { content: [{ type: "text"; text: string }] };

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
      const agent = registerAgent(db, {
        name: args.name as string,
        model: (args.model as string | undefined) ?? null,
        capabilities: (args.capabilities as string[] | undefined) ?? [],
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

    case "create_task": {
      const task = createTask(db, {
        project_id: args.project_id as string,
        parent_task_id: (args.parent_task_id as string | undefined) ?? null,
        sprint_id: (args.sprint_id as string | undefined) ?? null,
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

    case "assign_task": {
      const updated = updateTask(db, args.task_id as string, {
        assigned_agent_id: args.agent_id as string,
      });
      if (updated) {
        broadcast({ type: "task_assigned", payload: updated });
        autoLog(db, updated.id, `Assigned to agent`, agentName);
      }
      return ok({ success: true });
    }

    case "unassign_task": {
      const updated = updateTask(db, args.task_id as string, {
        assigned_agent_id: null,
      });
      if (updated) {
        broadcast({ type: "task_unassigned", payload: updated });
        autoLog(db, updated.id, `Unassigned from agent`, agentName);
      }
      return ok({ success: true });
    }

    case "update_task": {
      const updated = updateTask(db, args.task_id as string, {
        title: args.title as string | undefined,
        description: args.description as string | null | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        progress: args.progress as number | undefined,
        parent_task_id: args.parent_task_id as string | null | undefined,
        sprint_id: args.sprint_id as string | null | undefined,
        assigned_agent_id: args.assigned_agent_id as string | null | undefined,
        due_date: args.due_date as string | null | undefined,
      });
      if (updated) {
        broadcast({ type: "task_updated", payload: updated });
        const changes: string[] = [];
        if (args.status) changes.push(`status → ${args.status}`);
        if (args.progress !== undefined) changes.push(`progress → ${args.progress}%`);
        if (args.title) changes.push(`title → "${args.title}"`);
        const msg = changes.length > 0
          ? `Updated "${updated.title}": ${changes.join(", ")}`
          : `Updated "${updated.title}"`;
        autoLog(db, updated.id, msg, agentName);
      }
      return ok({ success: true });
    }

    case "complete_task": {
      const completed = completeTask(db, args.task_id as string);
      if (completed) {
        broadcast({ type: "task_completed", payload: completed });
        autoLog(db, completed.id, `Completed "${completed.title}"`, agentName);
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

    case "create_sprint": {
      const sprint = createSprint(db, {
        project_id: args.project_id as string,
        name: args.name as string,
        description: (args.description as string | undefined) ?? null,
        status: args.status as "planned" | "active" | "completed" | undefined,
        start_date: (args.start_date as string | undefined) ?? null,
        end_date: (args.end_date as string | undefined) ?? null,
      });
      broadcast({ type: "sprint_created", payload: sprint });
      return ok({ sprint_id: sprint.id });
    }

    case "list_sprints": {
      const sprints = listSprints(db, args.project_id as string | undefined);
      return ok({ sprints });
    }

    case "update_sprint": {
      const updated = updateSprint(db, args.sprint_id as string, {
        name: args.name as string | undefined,
        description: args.description as string | null | undefined,
        status: args.status as "planned" | "active" | "completed" | undefined,
        start_date: args.start_date as string | null | undefined,
        end_date: args.end_date as string | null | undefined,
      });
      if (updated) {
        broadcast({ type: "sprint_updated", payload: updated });
      }
      return ok({ success: true });
    }

    case "create_tag": {
      const tag = createTag(db, {
        project_id: args.project_id as string,
        name: args.name as string,
        color: args.color as string | undefined,
      });
      broadcast({ type: "tag_created", payload: tag });
      return ok({ tag_id: tag.id });
    }

    case "list_tags": {
      const tags = listTags(db, args.project_id as string);
      return ok({ tags });
    }

    case "add_tag": {
      const taskTag = addTagToTask(
        db,
        args.task_id as string,
        args.tag_id as string
      );
      broadcast({ type: "tag_added", payload: taskTag });
      return ok({ success: true });
    }

    case "remove_tag": {
      const removed = removeTagFromTask(
        db,
        args.task_id as string,
        args.tag_id as string
      );
      if (removed) {
        broadcast({ type: "tag_removed", payload: { id: "", task_id: args.task_id as string, tag_id: args.tag_id as string } });
      }
      return ok({ success: removed });
    }

    case "get_task_tags": {
      const tags = getTaskTags(db, args.task_id as string);
      return ok({ tags });
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
