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
  getAgentByName,
} from "../db.js";
import { broadcast } from "../websocket.js";

type ToolResult = { content: [{ type: "text"; text: string }] };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export async function handleTool(
  db: Database.Database,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
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
        title: args.title as string,
        description: (args.description as string | undefined) ?? null,
        priority: (args.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
        status: (args.status as "planned" | "in_progress" | "blocked" | "done" | undefined) ?? "planned",
      });
      broadcast({ type: "task_created", payload: task });
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
      });
      return ok({ tasks });
    }

    case "update_task": {
      const updated = updateTask(db, args.task_id as string, {
        title: args.title as string | undefined,
        description: args.description as string | null | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        progress: args.progress as number | undefined,
        parent_task_id: args.parent_task_id as string | null | undefined,
      });
      if (updated) {
        broadcast({ type: "task_updated", payload: updated });
      }
      return ok({ success: true });
    }

    case "complete_task": {
      const completed = completeTask(db, args.task_id as string);
      if (completed) {
        broadcast({ type: "task_completed", payload: completed });
      }
      return ok({ success: true });
    }

    case "log_activity": {
      const agentName = args.agent_name as string | undefined;
      let agentId: string | null = null;

      if (agentName) {
        let agent = getAgentByName(db, agentName);
        if (!agent) {
          agent = registerAgent(db, {
            name: agentName,
            model: null,
            capabilities: [],
          });
          broadcast({ type: "agent_registered", payload: agent });
        }
        agentId = agent.id;
      }

      const entry = logActivity(db, {
        task_id: args.task_id as string,
        agent_id: agentId,
        message: args.message as string,
      });
      broadcast({ type: "agent_activity", payload: entry });
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
      return ok({ blocker_id: blocker.id });
    }

    case "resolve_blocker": {
      const blocker = resolveBlocker(db, args.blocker_id as string);
      if (blocker) {
        broadcast({ type: "blocker_resolved", payload: blocker });
      }
      return ok({ success: true });
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
