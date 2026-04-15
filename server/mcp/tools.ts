import type Database from "better-sqlite3";
import type { Agent } from "../types.js";
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
  addDependency,
  removeDependency,
  listDependencies,
  listAgentSessions,
  searchTasks,
  getAgentById,
  getAgentActivity,
  getAgentCompletedToday,
  getAgentHealthStatus,
  addComment,
  listComments,
  reportWorkingOn,
  getFileConflicts,
  listNotifications,
  markNotificationRead,
  bulkUpdateTasks,
  getAgentStats,
  getSprintAgentContributions,
  generateReport,
  extractMentions,
  createNotification,
  listMentions,
  handleRecurringTaskCompletion,
  createProjectFromTemplate,
  listTemplates,
  getActivityStream,
  logCost,
  getAgentCostSummary,
  getSprintCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "../db/index.js";

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
        role: args.role as Agent["role"] | undefined,
        parent_agent_name: args.parent_agent_name as string | undefined,
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
        estimate: args.estimate as number | null | undefined,
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

    case "add_dependency": {
      const dep = addDependency(db, args.task_id as string, args.depends_on_task_id as string);
      broadcast({ type: "dependency_added", payload: dep });
      return ok({ dependency_id: dep.id });
    }

    case "remove_dependency": {
      const removed = removeDependency(db, args.dependency_id as string);
      return ok({ success: removed });
    }

    case "list_dependencies": {
      const deps = listDependencies(db, args.task_id as string);
      return ok({ dependencies: deps });
    }

    case "list_agent_sessions": {
      const sessions = listAgentSessions(db, args.agent_id as string);
      return ok({ sessions });
    }

    case "search_tasks": {
      const results = searchTasks(db, {
        query: args.query as string | undefined,
        project_id: args.project_id as string | undefined,
        sprint_id: args.sprint_id as string | undefined,
        status: args.status as "planned" | "in_progress" | "blocked" | "done" | undefined,
        priority: args.priority as "low" | "medium" | "high" | "urgent" | undefined,
        assigned_agent_id: args.assigned_agent_id as string | undefined,
        tag_id: args.tag_id as string | undefined,
        due_before: args.due_before as string | undefined,
        due_after: args.due_after as string | undefined,
      });
      return ok({ tasks: results });
    }

    // ─── R5: Mentions ─────────────────────────────────────────────────────

    case "list_mentions": {
      return ok({ mentions: listMentions(db, args.agent_name as string) });
    }

    // ─── R5: Templates ──────────────────────────────────────────────────

    case "create_project_from_template": {
      const project = createProjectFromTemplate(db, args.template_id as string, args.project_name as string);
      if (!project) return ok({ error: "Template not found" });
      broadcast({ type: "project_created", payload: project });
      return ok({ project });
    }

    case "list_templates": {
      return ok({ templates: listTemplates(db) });
    }

    // ─── R3: Comments ──────────────────────────────────────────────────────

    case "add_comment": {
      const comment = addComment(
        db,
        args.task_id as string,
        args.message as string,
        args.agent_name as string,
        args.agent_id as string | undefined
      );
      broadcast({ type: "comment_added", payload: comment });
      // Process @mentions
      const mentions = extractMentions(args.message as string);
      for (const name of mentions) {
        const notif = createNotification(db, `${args.agent_name} mentioned @${name} in a comment`);
        broadcast({ type: "notification_created", payload: notif });
      }
      return ok({ comment });
    }

    case "list_comments": {
      return ok({ comments: listComments(db, args.task_id as string) });
    }

    // ─── R3: File Locks ──────────────────────────────────────────────────────

    case "report_working_on": {
      const locks = reportWorkingOn(
        db,
        args.agent_id as string,
        args.task_id as string,
        args.file_paths as string[]
      );
      for (const lock of locks) {
        broadcast({ type: "file_lock_acquired", payload: lock });
      }
      const conflicts = getFileConflicts(db);
      for (const c of conflicts) {
        broadcast({ type: "file_conflict_detected", payload: c });
      }
      return ok({ locks, conflicts });
    }

    // ─── R3: Notifications ───────────────────────────────────────────────────

    case "list_notifications": {
      return ok({ notifications: listNotifications(db, (args.limit as number) ?? 50) });
    }

    case "mark_notification_read": {
      return ok({ success: markNotificationRead(db, args.notification_id as string) });
    }

    // ─── R3: Bulk Update ─────────────────────────────────────────────────────

    case "bulk_update_tasks": {
      const ids = args.task_ids as string[];
      const updates: Record<string, unknown> = {};
      if (args.status !== undefined) updates.status = args.status;
      if (args.priority !== undefined) updates.priority = args.priority;
      if (args.assigned_agent_id !== undefined) updates.assigned_agent_id = args.assigned_agent_id;
      const tasks = bulkUpdateTasks(db, ids, updates as any);
      for (const t of tasks) {
        broadcast({ type: "task_updated", payload: t });
      }
      return ok({ updated: tasks.length });
    }

    // ─── R4: Agent Stats ──────────────────────────────────────────────────

    case "get_agent_stats": {
      const stats = getAgentStats(db, args.agent_id as string, args.sprint_id as string | undefined);
      return ok(stats);
    }

    // ─── R4: Report ──────────────────────────────────────────────────────

    case "generate_report": {
      const report = generateReport(db, args.project_id as string, args.period as "day" | "week" | "sprint");
      return ok({ report });
    }

    case "get_agent_detail": {
      const agent = getAgentById(db, args.agent_id as string);
      if (!agent) return ok({ error: "Agent not found" });
      return ok({
        agent,
        health_status: getAgentHealthStatus(agent.last_seen_at),
        completed_today: getAgentCompletedToday(db, agent.id),
        recent_activity: getAgentActivity(db, agent.id, 20),
        sessions: listAgentSessions(db, agent.id),
      });
    }

    // ─── Cost & Token Tracking ────────────────────────────────────────

    case "log_cost": {
      const entry = logCost(db, {
        agent_id: (args.agent_id as string) ?? null,
        task_id: (args.task_id as string) ?? null,
        sprint_id: (args.sprint_id as string) ?? null,
        project_id: (args.project_id as string) ?? null,
        model: args.model as string,
        provider: args.provider as string,
        input_tokens: args.input_tokens as number,
        output_tokens: args.output_tokens as number,
        cost_usd: args.cost_usd as number,
      });
      return ok(entry);
    }

    case "get_cost_summary": {
      if (args.agent_id) return ok(getAgentCostSummary(db, args.agent_id as string));
      if (args.sprint_id) return ok(getSprintCostSummary(db, args.sprint_id as string));
      if (args.project_id) return ok(getProjectCostSummary(db, args.project_id as string));
      return ok({ error: "Provide agent_id, sprint_id, or project_id" });
    }

    case "get_cost_timeseries": {
      return ok(getCostTimeseries(db, {
        agent_id: args.agent_id as string | undefined,
        sprint_id: args.sprint_id as string | undefined,
        project_id: args.project_id as string | undefined,
        days: args.days as number | undefined,
      }));
    }

    case "get_cost_by_model": {
      return ok(getCostByModel(db, {
        project_id: args.project_id as string | undefined,
        sprint_id: args.sprint_id as string | undefined,
      }));
    }

    case "get_cost_by_agent": {
      return ok(getCostByAgent(db, {
        project_id: args.project_id as string | undefined,
        sprint_id: args.sprint_id as string | undefined,
      }));
    }

    // ─── Agent Performance Metrics ────────────────────────────────────────

    case "log_completion_metrics": {
      const entry = logCompletionMetrics(db, {
        task_id: args.task_id as string,
        agent_id: args.agent_id as string,
        lines_added: args.lines_added as number | undefined,
        lines_removed: args.lines_removed as number | undefined,
        files_changed: args.files_changed as number | undefined,
        tests_added: args.tests_added as number | undefined,
        tests_passing: args.tests_passing as number | undefined,
        duration_seconds: args.duration_seconds as number | undefined,
      });
      broadcast({ type: "metrics_logged", payload: entry });
      return ok(entry);
    }

    case "get_agent_comparison": {
      return ok(getAgentComparison(db));
    }

    case "get_agent_performance": {
      const perf = getAgentPerformance(db, args.agent_id as string);
      if (!perf) return ok({ error: "No metrics found for this agent" });
      return ok(perf);
    }

    case "get_task_type_breakdown": {
      return ok(getTaskTypeBreakdown(db, args.agent_id as string));
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
