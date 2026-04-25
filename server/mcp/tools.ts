import type Database from "better-sqlite3";
import { generateDigest, queryNaturalLanguage } from "../intelligence.js";
import {
  registerAgent,
  createProject,
  updateProject,
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
  createMilestone,
  listMilestones,
  updateMilestone,
  completeMilestone,
  getMilestone,
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
  getMilestoneAgentContributions,
  generateReport,
  extractMentions,
  createNotification,
  listMentions,
  handleRecurringTaskCompletion,
  recordMilestoneDailyStats,
  createProjectFromTemplate,
  listTemplates,
  getActivityStream,
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
  createReview,
  listReviewsForTask,
  updateReview,
  suggestAgent,
  createWorktree,
  getWorktreeById,
  getTaskWorktree,
  listActiveWorktrees,
  updateWorktreeStatus,
} from "../db/index.js";
import {
  suggestAgentSchema,
  registerAgentSchema,
  createReviewSchema,
  updateReviewSchema,
} from "../../shared/schemas.js";
import {
  createIngestionSource,
  listIngestionSources,
  rotateIngestionToken,
} from "../db/ingestion.js";
import { execFileSync } from "child_process";

import { broadcast } from "../websocket.js";
import {
  createGitIntegration,
  listGitIntegrations,
} from "../db/index.js";
import { syncGitHubIssues } from "../git-sync-service.js";

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

    case "update_project": {
      const project = updateProject(db, args.project_id as string, {
        name: args.name as string | undefined,
        description: args.description !== undefined ? (args.description as string | null) : undefined,
      });
      if (!project) return ok({ error: "Project not found" });
      broadcast({ type: "project_updated", payload: project });
      return ok({ project });
    }

    case "list_projects": {
      const projects = listProjects(db);
      return ok({ projects });
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

    case "create_milestone": {
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

    case "list_milestones": {
      const milestones = listMilestones(db, args.project_id as string | undefined);
      return ok({ milestones });
    }

    case "update_milestone": {
      const updated = updateMilestone(db, args.milestone_id as string, {
        name: args.name as string | undefined,
        description: args.description as string | null | undefined,
        acceptance_criteria: args.acceptance_criteria as string | null | undefined,
        target_date: args.target_date as string | null | undefined,
      });
      if (updated) {
        broadcast({ type: "milestone_updated", payload: updated });
      }
      return ok({ success: true });
    }

    case "complete_milestone": {
      const completed = completeMilestone(db, args.milestone_id as string);
      if (completed) {
        broadcast({ type: "milestone_achieved", payload: completed });
      }
      return ok({ success: completed !== null });
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
      const tasks = bulkUpdateTasks(db, ids, updates as Parameters<typeof bulkUpdateTasks>[2]);
      for (const t of tasks) {
        broadcast({ type: "task_updated", payload: t });
      }
      return ok({ updated: tasks.length });
    }

    // ─── R4: Agent Stats ──────────────────────────────────────────────────

    case "get_agent_stats": {
      const stats = getAgentStats(db, args.agent_id as string, args.milestone_id as string | undefined);
      return ok(stats);
    }

    // ─── R4: Report ──────────────────────────────────────────────────────

    case "generate_report": {
      const report = generateReport(db, args.project_id as string, args.period as "day" | "week" | "milestone");
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

    case "get_cost_summary": {
      if (args.agent_id) return ok(getAgentCostSummary(db, args.agent_id as string));
      if (args.milestone_id) return ok(getMilestoneCostSummary(db, args.milestone_id as string));
      if (args.project_id) return ok(getProjectCostSummary(db, args.project_id as string));
      return ok({ error: "Provide agent_id, milestone_id, or project_id" });
    }

    case "get_cost_timeseries": {
      return ok(getCostTimeseries(db, {
        agent_id: args.agent_id as string | undefined,
        milestone_id: args.milestone_id as string | undefined,
        project_id: args.project_id as string | undefined,
        days: args.days as number | undefined,
      }));
    }

    case "get_cost_by_model": {
      return ok(getCostByModel(db, {
        project_id: args.project_id as string | undefined,
        milestone_id: args.milestone_id as string | undefined,
      }));
    }

    case "get_cost_by_agent": {
      return ok(getCostByAgent(db, {
        project_id: args.project_id as string | undefined,
        milestone_id: args.milestone_id as string | undefined,
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

    case "create_review": {
      const { task_id, reviewer_name, reviewer_agent_id, status, comments, diff_summary } = createReviewSchema.parse(args);
      const review = createReview(db, {
        task_id,
        reviewer_name: reviewer_name ?? agentName ?? "unknown",
        reviewer_agent_id: reviewer_agent_id ?? null,
        status,
        comments: comments ?? null,
        diff_summary: diff_summary ?? null,
      });
      broadcast({ type: "review_created", payload: review });
      autoLog(db, review.task_id, `Review submitted: ${review.status}`, agentName);
      return ok({ review_id: review.id });
    }

    case "list_reviews": {
      return ok({ reviews: listReviewsForTask(db, args.task_id as string) });
    }

    case "update_review": {
      const { status, comments, diff_summary } = updateReviewSchema.parse(args);
      const updated = updateReview(db, args.review_id as string, { status, comments, diff_summary });
      if (!updated) return ok({ error: "Review not found" });
      broadcast({ type: "review_updated", payload: updated });
      autoLog(db, updated.task_id, `Review updated: ${updated.status}`, agentName);
      return ok({ review: updated });
    }

    // ─── R9a: Git Worktrees ────────────────────────────────────────────────

    case "create_worktree": {
      const task_id = args.task_id as string;
      const repo_path = args.repo_path as string;
      const branch_name = args.branch_name as string;
      const worktree_path = args.worktree_path as string;
      // Validate task exists before touching the filesystem
      const task = getTask(db, task_id);
      if (!task) return ok({ error: "Task not found" });
      // Prevent path traversal — both paths must be absolute and contain no ..
      if (!repo_path.startsWith("/") && !repo_path.match(/^[A-Za-z]:\\/)) {
        return ok({ error: "repo_path must be an absolute path" });
      }
      if (!worktree_path.startsWith("/") && !worktree_path.match(/^[A-Za-z]:\\/)) {
        return ok({ error: "worktree_path must be an absolute path" });
      }
      if (repo_path.includes("..") || worktree_path.includes("..")) {
        return ok({ error: "paths must not contain .." });
      }
      try {
        execFileSync("git", ["-C", repo_path, "worktree", "add", "-b", branch_name, worktree_path], {
          timeout: 30000,
          stdio: "pipe",
        });
      } catch (err) {
        const stderr = err != null && typeof err === "object" && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
          ? (err as { stderr: Buffer }).stderr.toString().trim()
          : undefined;
        const msg = stderr || (err instanceof Error ? err.message : String(err));
        return ok({ error: `git worktree add failed: ${msg}` });
      }
      const worktree = createWorktree(db, { task_id, repo_path, branch_name, worktree_path });
      broadcast({ type: "worktree_created", payload: worktree });
      autoLog(db, task_id, `Worktree created: ${branch_name}`, agentName);
      return ok(worktree);
    }

    case "cleanup_worktree": {
      const worktree = getWorktreeById(db, args.worktree_id as string);
      if (!worktree) return ok({ error: "Worktree not found" });
      const force = args.force as boolean | undefined;
      const gitArgs = ["worktree", "remove", worktree.worktree_path];
      if (force) gitArgs.push("--force");
      try {
        execFileSync("git", ["-C", worktree.repo_path, ...gitArgs], {
          timeout: 30000,
          stdio: "pipe",
        });
      } catch (err) {
        const stderr = err != null && typeof err === "object" && "stderr" in err && Buffer.isBuffer((err as { stderr: unknown }).stderr)
          ? (err as { stderr: Buffer }).stderr.toString().trim()
          : undefined;
        const msg = stderr || (err instanceof Error ? err.message : String(err));
        return ok({ error: `git worktree remove failed: ${msg}` });
      }
      const newStatus = ((args.status as string | undefined) ?? "removed") as import("../../shared/types.js").WorktreeStatus;
      const updated = updateWorktreeStatus(db, worktree.id, newStatus);
      if (updated) broadcast({ type: "worktree_updated", payload: updated });
      autoLog(db, worktree.task_id, `Worktree cleaned up: ${worktree.branch_name} (${newStatus})`, agentName);
      return ok(updated ?? worktree);
    }

    case "list_worktrees": {
      return ok(listActiveWorktrees(db));
    }

    case "get_worktree_status": {
      const worktree = getTaskWorktree(db, args.task_id as string);
      if (!worktree) return ok({ error: "No worktree found for this task" });
      return ok(worktree);
    }

    // ─── R10: Intelligent Routing ─────────────────────────────────────────

    case "suggest_agent": {
      const { task_id } = suggestAgentSchema.parse(args);
      const taskExists = db.prepare("SELECT id FROM tasks WHERE id = ?").get(task_id);
      if (!taskExists) return ok({ error: "Task not found" });
      const suggestion = suggestAgent(db, task_id);
      return ok(suggestion);
    }

    // ─── R11.3: Ingestion Sources ─────────────────────────────────────────

    case "list_ingestion_sources":
      return ok(listIngestionSources(db));

    case "create_ingestion_source": {
      const name = args.name as string;
      const kind = args.kind as string;
      const project_id = (args.project_id as string | undefined) ?? null;
      if (!name || !kind) return ok({ error: "name and kind are required" });
      const result = createIngestionSource(db, { name, kind: kind as import("../db/ingestion.js").IngestionSourceKind, project_id });
      // token is shown once — agent must save it
      return ok(result);
    }

    case "rotate_ingestion_token": {
      const source_id = args.source_id as string;
      if (!source_id) return ok({ error: "source_id is required" });
      const result = rotateIngestionToken(db, source_id);
      if (!result) return ok({ error: "Ingestion source not found" });
      return ok(result);
    }

    // ─── R12.1: Intelligence ───────────────────────────────────────────────

    case "query": {
      try {
        const answer = await queryNaturalLanguage(
          db,
          args.question as string,
          args.project_id as string | undefined
        );
        return ok({ answer });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Query failed";
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }

    case "generate_digest": {
      try {
        const digest = await generateDigest(
          db,
          args.period as "daily" | "weekly",
          args.project_id as string | undefined
        );
        return ok({ digest });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Digest generation failed";
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }

    // ─── R12.2: Git Host Sync ─────────────────────────────────────────────────

    case "add_git_integration": {
      try {
        const integration = createGitIntegration(
          db,
          args.project_id as string,
          args.provider as "github" | "gitlab",
          args.owner as string,
          args.repo as string,
          args.token as string,
          Boolean(args.auto_sync)
        );
        return ok({ integration_id: integration.id, owner: integration.owner, repo: integration.repo });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to add integration";
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }

    case "sync_github_issues": {
      try {
        const result = await syncGitHubIssues(db, args.integration_id as string);
        return ok({ issues_pulled: result.issues_pulled, issues_updated: result.issues_updated, errors: result.errors });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Sync failed";
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }

    case "list_git_integrations": {
      try {
        const integrations = listGitIntegrations(db, args.project_id as string | undefined);
        return ok({ integrations });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to list integrations";
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
      }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
