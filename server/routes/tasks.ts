import { Router } from "express";
import type Database from "better-sqlite3";
import type { TaskStatus, TaskPriority } from "../types.js";
import type { UpdateTaskInput } from "../db/tasks.js";
import { BULK_UPDATE_MAX } from "../constants.js";
import {
  listTasks,
  createTask,
  getTask,
  updateTask,
  completeTask,
  searchTasks,
  bulkUpdateTasks,
  logActivity,
  recordMilestoneDailyStats,
  evaluateAlertRules,
  handleRecurringTaskCompletion,
  getTimeSpent,
  resolveBlockersForTask,
  suggestAgent,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { requireEntity } from "./handlers.js";

export function taskRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:projectId/tasks", (req, res) => {
    res.json(listTasks(db, { project_id: req.params.projectId }));
  });

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

  router.post("/api/tasks", (req, res) => {
    const { project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, priority, status, due_date, start_date, estimate, recurrence_rule } =
      req.body as {
        project_id: string;
        parent_task_id?: string | null;
        milestone_id?: string | null;
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
      badRequest(res, "project_id, title, and priority are required");
      return;
    }
    const task = createTask(db, {
      project_id,
      parent_task_id: parent_task_id ?? null,
      milestone_id: milestone_id ?? null,
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
    if (!task_ids?.length || !updates) { badRequest(res, "task_ids and updates are required"); return; }
    if (task_ids.length > BULK_UPDATE_MAX) { badRequest(res, `Maximum ${BULK_UPDATE_MAX} tasks per bulk update`); return; }
    const tasks = bulkUpdateTasks(db, task_ids, updates as UpdateTaskInput);
    for (const t of tasks) broadcast({ type: "task_updated", payload: t });
    if (updates.status) {
      const milestoneIds = new Set(tasks.filter((t) => t.milestone_id).map((t) => t.milestone_id!));
      for (const mid of milestoneIds) recordMilestoneDailyStats(db, mid);
    }
    res.json({ updated: tasks.length, tasks });
  });

  // GET /api/tasks/search (must be before :id param route)
  router.get("/api/tasks/search", (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    res.json(searchTasks(db, {
      query: q.q,
      project_id: q.project_id,
      milestone_id: q.milestone_id,
      status: q.status as TaskStatus | undefined,
      priority: q.priority as TaskPriority | undefined,
      assigned_agent_id: q.assigned_agent_id,
      tag_id: q.tag_id,
      due_before: q.due_before,
      due_after: q.due_after,
    }));
  });

  router.get("/api/tasks/:id", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    res.json(task);
  });

  router.patch("/api/tasks/:id", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    const body = req.body as Parameters<typeof updateTask>[2];
    const updated = updateTask(db, req.params.id, body);
    broadcast({ type: "task_updated", payload: updated! });
    if (body.status && body.status !== task.status && (body.status === "done" || task.status === "blocked")) {
      for (const b of resolveBlockersForTask(db, req.params.id)) {
        broadcast({ type: "blocker_resolved", payload: b });
      }
    }
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
    if (body.status && body.status !== task.status && updated?.milestone_id) {
      recordMilestoneDailyStats(db, updated.milestone_id);
    }
    res.json(updated);
  });

  router.post("/api/tasks/:id/complete", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    const completed = completeTask(db, req.params.id);
    broadcast({ type: "task_completed", payload: completed! });
    for (const b of resolveBlockersForTask(db, req.params.id)) {
      broadcast({ type: "blocker_resolved", payload: b });
    }
    const alertNotifs = evaluateAlertRules(db, "task_completed", { task_id: completed!.id, priority: completed!.priority });
    for (const n of alertNotifs) broadcast({ type: "notification_created", payload: n });
    if (completed?.milestone_id) {
      recordMilestoneDailyStats(db, completed.milestone_id);
    }
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

  router.get("/api/tasks/:id/time-spent", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    res.json({ time_spent_seconds: getTimeSpent(db, req.params.id) });
  });

  router.get("/api/tasks/:id/suggest-agent", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    const suggestion = suggestAgent(db, req.params.id);
    res.json(suggestion ?? null);
  });

  return router;
}
