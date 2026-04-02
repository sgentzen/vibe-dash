import { Router } from "express";
import type Database from "better-sqlite3";
import type { TaskStatus, SprintStatus } from "./types.js";
import {
  listProjects,
  createProject,
  listTasks,
  createTask,
  getTask,
  updateTask,
  completeTask,
  listAgents,
  getRecentActivity,
  getActiveBlockers,
  createBlocker,
  resolveBlocker,
  listSprints,
  createSprint,
  getSprint,
  updateSprint,
  logActivity,
  getAgentCurrentTask,
  getAgentHealthStatus,
  createTag,
  listTags,
  addTagToTask,
  removeTagFromTask,
  getTaskTags,
  getSprintCapacity,
  getTimeSpent,
  addDependency,
  removeDependency,
  listDependencies,
  getBlockingTasks,
  listAgentSessions,
  searchTasks,
  getAgentById,
  getAgentActivity,
  getAgentCompletedToday,
  createSavedFilter,
  listSavedFilters,
  deleteSavedFilter,
  getAgentStats,
  getSprintAgentContributions,
  extractMentions,
  createNotification,
  listMentions,
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  fireWebhooks,
  handleRecurringTaskCompletion,
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  createProjectFromTemplate,
  getActivityStream,
  recordDailyStats,
  getSprintDailyStats,
  getVelocityTrend,
  getAgentActivityHeatmap,
  generateReport,
  addComment,
  listComments,
  reportWorkingOn,
  releaseFileLocks,
  getActiveFileLocks,
  getFileConflicts,
  createAlertRule,
  listAlertRules,
  toggleAlertRule,
  deleteAlertRule,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  evaluateAlertRules,
  bulkUpdateTasks,
  ACTIVE_THRESHOLD_MINUTES,
} from "./db.js";
import { broadcast as wsBroadcast } from "./websocket.js";
import type { WsEvent } from "./types.js";
import rateLimit from "express-rate-limit";

const dependencyDeleteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 30, // limit each IP to 30 delete requests per windowMs
});

function makeBroadcast(db: Database.Database) {
  return (event: WsEvent) => {
    wsBroadcast(event);
    void fireWebhooks(db, event.type, event.payload);
  };
}

export function createRouter(db: Database.Database): Router {
  const broadcast = makeBroadcast(db);
  const router = Router();

  const statsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const firstRunLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // GET /api/first-run — returns true if no projects exist
  router.get("/api/first-run", firstRunLimiter, (_req, res) => {
    const count = (
      db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }
    ).count;
    res.json({ firstRun: count === 0 });
  });

  // GET /api/stats
  router.get("/api/stats", statsLimiter, (_req, res) => {
    const projects = (
      db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    const tasks = (
      db.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status != 'done'").get() as {
        count: number;
      }
    ).count;
    const activeAgents = (
      db.prepare(
        // Safe interpolation: ACTIVE_THRESHOLD_MINUTES is a module-level numeric constant, not user input
        `SELECT COUNT(*) AS count FROM agents WHERE last_seen_at >= datetime('now', '-${ACTIVE_THRESHOLD_MINUTES} minutes') AND parent_agent_id IS NULL`
      ).get() as {
        count: number;
      }
    ).count;
    const alerts = (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM blockers WHERE resolved_at IS NULL"
        )
        .get() as { count: number }
    ).count;
    res.json({ projects, tasks, activeAgents, alerts });
  });

  // GET /api/projects
  router.get("/api/projects", (_req, res) => {
    res.json(listProjects(db));
  });

  // POST /api/projects
  router.post("/api/projects", (req, res) => {
    const { name, description } = req.body as {
      name: string;
      description?: string | null;
    };
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const project = createProject(db, {
      name,
      description: description ?? null,
    });
    broadcast({ type: "project_created", payload: project });
    res.status(201).json(project);
  });

  // GET /api/projects/:projectId/tasks
  router.get("/api/projects/:projectId/tasks", (req, res) => {
    res.json(listTasks(db, { project_id: req.params.projectId }));
  });

  // GET /api/tasks
  router.get("/api/tasks", (req, res) => {
    const { project_id, status, parent_task_id, assigned_agent_id } = req.query as {
      project_id?: string;
      status?: string;
      parent_task_id?: string;
      assigned_agent_id?: string;
    };
    res.json(
      listTasks(db, {
        project_id,
        status: status as TaskStatus | undefined,
        parent_task_id,
        assigned_agent_id,
      })
    );
  });

  // POST /api/tasks
  router.post("/api/tasks", (req, res) => {
    const { project_id, parent_task_id, sprint_id, assigned_agent_id, title, description, priority, status, due_date, start_date, estimate, recurrence_rule } =
      req.body as {
        project_id: string;
        parent_task_id?: string | null;
        sprint_id?: string | null;
        assigned_agent_id?: string | null;
        title: string;
        description?: string | null;
        priority: string;
        status?: string;
        due_date?: string | null;
        start_date?: string | null;
        estimate?: number | null;
        recurrence_rule?: string | null;
      };
    if (!project_id || !title || !priority) {
      res.status(400).json({ error: "project_id, title, and priority are required" });
      return;
    }
    const task = createTask(db, {
      project_id,
      parent_task_id: parent_task_id ?? null,
      sprint_id: sprint_id ?? null,
      assigned_agent_id: assigned_agent_id ?? null,
      title,
      description: description ?? null,
      priority: priority as Parameters<typeof createTask>[1]["priority"],
      status: status as Parameters<typeof createTask>[1]["status"],
      due_date: due_date ?? null,
      start_date: start_date ?? null,
      estimate: estimate ?? null,
      recurrence_rule: recurrence_rule ?? null,
    });
    broadcast({ type: "task_created", payload: task });
    res.status(201).json(task);
  });

  // PATCH /api/tasks/bulk (must be before :id param route)
  router.patch("/api/tasks/bulk", (req, res) => {
    const { task_ids, updates } = req.body as { task_ids: string[]; updates: Record<string, unknown> };
    if (!task_ids?.length || !updates) { res.status(400).json({ error: "task_ids and updates are required" }); return; }
    if (task_ids.length > 200) { res.status(400).json({ error: "Maximum 200 tasks per bulk update" }); return; }
    const tasks = bulkUpdateTasks(db, task_ids, updates as any);
    for (const t of tasks) broadcast({ type: "task_updated", payload: t });
    // Record burndown stats for affected sprints when status changes
    if (updates.status) {
      const sprintIds = new Set(tasks.filter((t) => t.sprint_id).map((t) => t.sprint_id!));
      for (const sid of sprintIds) recordDailyStats(db, sid);
    }
    res.json({ updated: tasks.length, tasks });
  });

  // GET /api/tasks/search (must be before :id param route)
  router.get("/api/tasks/search", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(searchTasks(db, {
      query: q.q,
      project_id: q.project_id,
      sprint_id: q.sprint_id,
      status: q.status as any,
      priority: q.priority as any,
      assigned_agent_id: q.assigned_agent_id,
      tag_id: q.tag_id,
      due_before: q.due_before,
      due_after: q.due_after,
    }));
  });

  // GET /api/tasks/:id
  router.get("/api/tasks/:id", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  });

  // PATCH /api/tasks/:id
  router.patch("/api/tasks/:id", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const body = req.body as Parameters<typeof updateTask>[2];
    const updated = updateTask(db, req.params.id, body);
    broadcast({ type: "task_updated", payload: updated! });
    // Auto-log the change
    const changes: string[] = [];
    if (body.status && body.status !== task.status) changes.push(`status → ${body.status}`);
    if (body.progress !== undefined && body.progress !== task.progress) changes.push(`progress → ${body.progress}%`);
    if (changes.length > 0) {
      const entry = logActivity(db, {
        task_id: updated!.id,
        agent_id: null,
        message: `${changes.join(", ")} on "${updated!.title}"`,
      });
      broadcast({
        type: "agent_activity",
        payload: { ...entry, agent_name: null, task_title: updated!.title },
      });
    }
    // Record burndown stats when task status changes and task has a sprint
    if (body.status && body.status !== task.status && updated?.sprint_id) {
      recordDailyStats(db, updated.sprint_id);
    }
    res.json(updated);
  });

  // POST /api/tasks/:id/complete
  router.post("/api/tasks/:id/complete", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    const completed = completeTask(db, req.params.id);
    broadcast({ type: "task_completed", payload: completed! });
    const alertNotifs = evaluateAlertRules(db, "task_completed", { task_id: completed!.id, priority: completed!.priority });
    for (const n of alertNotifs) broadcast({ type: "notification_created", payload: n });
    // Record daily stats if task has a sprint
    if (completed?.sprint_id) {
      recordDailyStats(db, completed.sprint_id);
    }
    // Handle recurring tasks — create next instance
    if (completed) {
      const nextTask = handleRecurringTaskCompletion(db, completed.id);
      if (nextTask) {
        broadcast({ type: "task_created", payload: nextTask });
      }
    }
    const entry = logActivity(db, {
      task_id: completed!.id,
      agent_id: null,
      message: `Completed "${completed!.title}"`,
    });
    broadcast({
      type: "agent_activity",
      payload: { ...entry, agent_name: null, task_title: completed!.title },
    });
    res.json(completed);
  });

  // GET /api/agents
  router.get("/api/agents", (_req, res) => {
    const agents = listAgents(db);
    const withStatus = agents.map((a) => {
      const health_status = getAgentHealthStatus(a.last_seen_at);
      return {
        ...a,
        health_status,
        active: health_status === "active",
        current_task_title: getAgentCurrentTask(db, a.id),
      };
    });
    res.json(withStatus);
  });

  // GET /api/activity
  router.get("/api/activity", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json(getRecentActivity(db, isNaN(limit) ? 50 : limit));
  });

  // GET /api/blockers
  router.get("/api/blockers", (_req, res) => {
    res.json(getActiveBlockers(db));
  });

  // POST /api/blockers
  router.post("/api/blockers", (req, res) => {
    const { task_id, reason } = req.body as {
      task_id: string;
      reason: string;
    };
    if (!task_id || !reason) {
      res.status(400).json({ error: "task_id and reason are required" });
      return;
    }
    const blocker = createBlocker(db, { task_id, reason });
    const task = getTask(db, task_id);
    broadcast({ type: "blocker_reported", payload: blocker });
    if (task) broadcast({ type: "task_updated", payload: task });
    const alertNotifs = evaluateAlertRules(db, "blocker_reported", { task_id, priority: task?.priority });
    for (const n of alertNotifs) broadcast({ type: "notification_created", payload: n });
    res.status(201).json(blocker);
  });

  // POST /api/blockers/:id/resolve
  router.post("/api/blockers/:id/resolve", (req, res) => {
    const resolved = resolveBlocker(db, req.params.id);
    if (!resolved) {
      res.status(404).json({ error: "Blocker not found" });
      return;
    }
    const task = getTask(db, resolved.task_id);
    broadcast({ type: "blocker_resolved", payload: resolved });
    if (task) broadcast({ type: "task_updated", payload: task });
    res.json(resolved);
  });

  // GET /api/sprints
  router.get("/api/sprints", (req, res) => {
    const { project_id } = req.query as { project_id?: string };
    res.json(listSprints(db, project_id));
  });

  // POST /api/sprints
  router.post("/api/sprints", (req, res) => {
    const { project_id, name, description, status, start_date, end_date } =
      req.body as {
        project_id: string;
        name: string;
        description?: string | null;
        status?: string;
        start_date?: string | null;
        end_date?: string | null;
      };
    if (!project_id || !name) {
      res.status(400).json({ error: "project_id and name are required" });
      return;
    }
    const sprint = createSprint(db, {
      project_id,
      name,
      description: description ?? null,
      status: status as SprintStatus | undefined,
      start_date: start_date ?? null,
      end_date: end_date ?? null,
    });
    broadcast({ type: "sprint_created", payload: sprint });
    res.status(201).json(sprint);
  });

  // PATCH /api/sprints/:id
  router.patch("/api/sprints/:id", (req, res) => {
    const sprint = getSprint(db, req.params.id);
    if (!sprint) {
      res.status(404).json({ error: "Sprint not found" });
      return;
    }
    const updated = updateSprint(db, req.params.id, req.body as Parameters<typeof updateSprint>[2]);
    broadcast({ type: "sprint_updated", payload: updated! });
    res.json(updated);
  });

  // ─── Tags ────────────────────────────────────────────────────────────────

  // GET /api/projects/:projectId/tags
  router.get("/api/projects/:projectId/tags", (req, res) => {
    res.json(listTags(db, req.params.projectId));
  });

  // POST /api/projects/:projectId/tags
  router.post("/api/projects/:projectId/tags", (req, res) => {
    const { name, color } = req.body as { name: string; color?: string };
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      res.status(400).json({ error: "color must be a hex color like #ff0000" });
      return;
    }
    const tag = createTag(db, { project_id: req.params.projectId, name, color });
    broadcast({ type: "tag_created", payload: tag });
    res.status(201).json(tag);
  });

  // GET /api/tasks/:id/tags
  router.get("/api/tasks/:id/tags", (req, res) => {
    res.json(getTaskTags(db, req.params.id));
  });

  // POST /api/tasks/:id/tags
  router.post("/api/tasks/:id/tags", (req, res) => {
    const { tag_id } = req.body as { tag_id: string };
    if (!tag_id) {
      res.status(400).json({ error: "tag_id is required" });
      return;
    }
    const taskTag = addTagToTask(db, req.params.id, tag_id);
    broadcast({ type: "tag_added", payload: taskTag });
    res.status(201).json(taskTag);
  });

  // DELETE /api/tasks/:id/tags/:tagId
  router.delete("/api/tasks/:id/tags/:tagId", (req, res) => {
    const removed = removeTagFromTask(db, req.params.id, req.params.tagId);
    if (removed) {
      broadcast({ type: "tag_removed", payload: { id: "", task_id: req.params.id, tag_id: req.params.tagId } });
    }
    res.json({ success: removed });
  });

  // ─── R2: Sprint Capacity ─────────────────────────────────────────────────

  router.get("/api/sprints/:id/capacity", (req, res) => {
    const sprint = getSprint(db, req.params.id);
    if (!sprint) { res.status(404).json({ error: "Sprint not found" }); return; }
    res.json(getSprintCapacity(db, req.params.id));
  });

  // ─── R2: Task time spent ────────────────────────────────────────────────

  router.get("/api/tasks/:id/time-spent", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json({ time_spent_seconds: getTimeSpent(db, req.params.id) });
  });

  // ─── R2: Dependencies ──────────────────────────────────────────────────

  router.get("/api/tasks/:id/dependencies", (req, res) => {
    res.json(listDependencies(db, req.params.id));
  });

  router.get("/api/tasks/:id/blocking", (req, res) => {
    res.json(getBlockingTasks(db, req.params.id));
  });

  router.post("/api/tasks/:id/dependencies", (req, res) => {
    const { depends_on_task_id } = req.body as { depends_on_task_id: string };
    if (!depends_on_task_id) { res.status(400).json({ error: "depends_on_task_id is required" }); return; }
    const dep = addDependency(db, req.params.id, depends_on_task_id);
    broadcast({ type: "dependency_added", payload: dep });
    res.status(201).json(dep);
  });

  router.delete("/api/dependencies/:id", dependencyDeleteLimiter, (req, res) => {
    // Read before delete so we can broadcast
    const dep = db.prepare("SELECT * FROM task_dependencies WHERE id = ?").get(req.params.id) as any;
    const removed = removeDependency(db, req.params.id);
    if (removed && dep) {
      broadcast({ type: "dependency_removed", payload: dep });
    }
    res.json({ success: removed });
  });

  // ─── R2: Agent Detail ──────────────────────────────────────────────────

  router.get("/api/agents/:id", (req, res) => {
    const agent = getAgentById(db, req.params.id);
    if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
    res.json({
      ...agent,
      health_status: getAgentHealthStatus(agent.last_seen_at),
      completed_today: getAgentCompletedToday(db, agent.id),
      current_task_title: getAgentCurrentTask(db, agent.id),
    });
  });

  router.get("/api/agents/:id/activity", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json(getAgentActivity(db, req.params.id, isNaN(limit) ? 50 : limit));
  });

  router.get("/api/agents/:id/sessions", (req, res) => {
    res.json(listAgentSessions(db, req.params.id));
  });

  // ─── R2: Saved Filters ────────────────────────────────────────────────

  router.get("/api/filters", (_req, res) => {
    res.json(listSavedFilters(db));
  });

  router.post("/api/filters", (req, res) => {
    const { name, filter_json } = req.body as { name: string; filter_json: string };
    if (!name || !filter_json) { res.status(400).json({ error: "name and filter_json are required" }); return; }
    res.status(201).json(createSavedFilter(db, name, filter_json));
  });

  router.delete("/api/filters/:id", (req, res) => {
    res.json({ success: deleteSavedFilter(db, req.params.id) });
  });

  // ─── R3: Task Comments ──────────────────────────────────────────────

  router.get("/api/tasks/:id/comments", (req, res) => {
    res.json(listComments(db, req.params.id));
  });

  router.post("/api/tasks/:id/comments", (req, res) => {
    const { message, author_name, agent_id } = req.body as { message: string; author_name: string; agent_id?: string };
    if (!message || !author_name) { res.status(400).json({ error: "message and author_name are required" }); return; }
    const comment = addComment(db, req.params.id, message, author_name, agent_id);
    broadcast({ type: "comment_added", payload: comment });

    // Process @mentions
    const mentions = extractMentions(message);
    for (const name of mentions) {
      const notif = createNotification(db, `${author_name} mentioned @${name} in a comment`);
      broadcast({ type: "notification_created", payload: notif });
    }

    // Evaluate alert rules for comment events
    const notifications = evaluateAlertRules(db, "comment_added", { task_id: req.params.id });
    for (const n of notifications) broadcast({ type: "notification_created", payload: n });

    res.status(201).json(comment);
  });

  // ─── R3: Agent File Locks ──────────────────────────────────────────

  router.post("/api/agents/:id/file-locks", (req, res) => {
    const { task_id, file_paths } = req.body as { task_id: string; file_paths: string[] };
    if (!task_id || !file_paths?.length) { res.status(400).json({ error: "task_id and file_paths are required" }); return; }
    const locks = reportWorkingOn(db, req.params.id, task_id, file_paths);
    for (const lock of locks) broadcast({ type: "file_lock_acquired", payload: lock });
    const conflicts = getFileConflicts(db);
    for (const c of conflicts) broadcast({ type: "file_conflict_detected", payload: c });
    res.status(201).json({ locks, conflicts });
  });

  router.delete("/api/agents/:id/file-locks", (req, res) => {
    const taskId = req.query.task_id as string | undefined;
    const released = releaseFileLocks(db, req.params.id, taskId);
    res.json({ released });
  });

  router.get("/api/file-locks", (_req, res) => {
    res.json(getActiveFileLocks(db));
  });

  router.get("/api/file-locks/conflicts", (_req, res) => {
    res.json(getFileConflicts(db));
  });

  // ─── R3: Alert Rules ───────────────────────────────────────────────

  router.get("/api/alert-rules", (_req, res) => {
    res.json(listAlertRules(db));
  });

  router.post("/api/alert-rules", (req, res) => {
    const { event_type, filter_json } = req.body as { event_type: string; filter_json?: string };
    if (!event_type) { res.status(400).json({ error: "event_type is required" }); return; }
    res.status(201).json(createAlertRule(db, event_type, filter_json));
  });

  router.patch("/api/alert-rules/:id", (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    const rule = toggleAlertRule(db, req.params.id, enabled);
    if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
    res.json(rule);
  });

  router.delete("/api/alert-rules/:id", (req, res) => {
    res.json({ success: deleteAlertRule(db, req.params.id) });
  });

  // ─── R3: Notifications ─────────────────────────────────────────────

  router.get("/api/notifications", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json(listNotifications(db, isNaN(limit) ? 50 : limit));
  });

  router.get("/api/notifications/unread-count", (_req, res) => {
    res.json({ count: getUnreadNotificationCount(db) });
  });

  router.patch("/api/notifications/:id/read", (req, res) => {
    res.json({ success: markNotificationRead(db, req.params.id) });
  });

  router.post("/api/notifications/mark-all-read", (_req, res) => {
    res.json({ marked: markAllNotificationsRead(db) });
  });

  // ─── R4: Agent Stats ─────────────────────────────────────────────

  router.get("/api/agents/:id/stats", (req, res) => {
    const sprintId = req.query.sprint_id as string | undefined;
    res.json(getAgentStats(db, req.params.id, sprintId));
  });

  // ─── R4: Sprint Contributions ──────────────────────────────────────

  router.get("/api/sprints/:id/contributions", (req, res) => {
    res.json(getSprintAgentContributions(db, req.params.id));
  });

  // ─── R4: Sprint Burndown ───────────────────────────────────────────

  router.get("/api/sprints/:id/burndown", (req, res) => {
    res.json(getSprintDailyStats(db, req.params.id));
  });

  router.post("/api/sprints/:id/record-stats", (req, res) => {
    const stats = recordDailyStats(db, req.params.id);
    broadcast({ type: "daily_stats_recorded", payload: stats });
    res.json(stats);
  });

  // ─── R4: Velocity ──────────────────────────────────────────────────

  router.get("/api/velocity", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "5", 10);
    const projectId = req.query.project_id as string | undefined;
    res.json(getVelocityTrend(db, isNaN(limit) ? 5 : limit, projectId));
  });

  // ─── R4: Activity Heatmap ──────────────────────────────────────────

  router.get("/api/activity-heatmap", (req, res) => {
    const projectId = req.query.project_id as string | undefined;
    res.json(getAgentActivityHeatmap(db, projectId));
  });

  // ─── R4: Reports ───────────────────────────────────────────────────

  router.post("/api/projects/:id/report", (req, res) => {
    const period = (req.body.period as "day" | "week" | "sprint") ?? "week";
    res.json({ report: generateReport(db, req.params.id, period) });
  });

  // ─── R5: Mentions ───────────────────────────────────────────────

  router.get("/api/mentions/:agent_name", (req, res) => {
    res.json(listMentions(db, req.params.agent_name));
  });

  // ─── R5: Templates ────────────────────────────────────────────

  router.get("/api/templates", (_req, res) => {
    res.json(listTemplates(db));
  });

  router.post("/api/templates", (req, res) => {
    const { name, description, template_json } = req.body as { name: string; description?: string; template_json: string };
    if (!name || !template_json) { res.status(400).json({ error: "name and template_json are required" }); return; }
    res.status(201).json(createTemplate(db, name, description ?? null, template_json));
  });

  router.get("/api/templates/:id", (req, res) => {
    const t = getTemplate(db, req.params.id);
    if (!t) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(t);
  });

  router.delete("/api/templates/:id", (req, res) => {
    res.json({ success: deleteTemplate(db, req.params.id) });
  });

  router.post("/api/templates/:id/instantiate", (req, res) => {
    const { project_name } = req.body as { project_name: string };
    if (!project_name) { res.status(400).json({ error: "project_name is required" }); return; }
    const project = createProjectFromTemplate(db, req.params.id, project_name);
    if (!project) { res.status(404).json({ error: "Template not found" }); return; }
    broadcast({ type: "project_created", payload: project });
    res.status(201).json(project);
  });

  // ─── R5: Activity Stream ───────────────────────────────────────

  router.get("/api/activity-stream", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(getActivityStream(db, {
      agent_id: q.agent_id,
      project_id: q.project_id,
      since: q.since,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
    }));
  });

  // ─── R6: Webhooks ───────────────────────────────────────────────

  router.get("/api/webhooks", (_req, res) => {
    res.json(listWebhooks(db));
  });

  router.post("/api/webhooks", (req, res) => {
    const { url, event_types } = req.body as { url: string; event_types: string[] };
    if (!url || !event_types || !Array.isArray(event_types)) { res.status(400).json({ error: "url and event_types (array) are required" }); return; }
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) { res.status(400).json({ error: "Only http/https URLs allowed" }); return; }
    } catch { res.status(400).json({ error: "Invalid URL" }); return; }
    res.status(201).json(createWebhook(db, url, event_types));
  });

  router.patch("/api/webhooks/:id", (req, res) => {
    const updates = req.body as { url?: string; event_types?: string[]; active?: boolean };
    const hook = updateWebhook(db, req.params.id, updates);
    if (!hook) { res.status(404).json({ error: "Webhook not found" }); return; }
    res.json(hook);
  });

  router.delete("/api/webhooks/:id", (req, res) => {
    res.json({ success: deleteWebhook(db, req.params.id) });
  });

  return router;
}
