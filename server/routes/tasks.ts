import { Router } from "express";
import type Database from "better-sqlite3";
import type { TaskStatus, TaskPriority } from "../types.js";
import type { UpdateTaskInput } from "../db/tasks.js";
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
  getTimeSpent,
  resolveBlockersForTask,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { requireEntity, handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { createTaskSchema, updateTaskSchema, bulkUpdateTasksSchema } from "../../shared/schemas.js";

// Parse optional ?limit / ?offset. Left undefined when absent so listTasks returns
// every row (the UI renders a full board); when present they are clamped in db/tasks.
function parsePaging(query: Record<string, unknown>): { limit?: number; offset?: number } {
  return {
    limit: query.limit !== undefined ? Number(query.limit) : undefined,
    offset: query.offset !== undefined ? Number(query.offset) : undefined,
  };
}

export function taskRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/projects/:projectId/tasks", (req, res) => {
    const { limit, offset } = parsePaging(req.query);
    res.json(listTasks(db, { project_id: req.params.projectId, limit, offset }));
  });

  router.get("/api/tasks", (req, res) => {
    const { project_id, status, parent_task_id, assigned_agent_id } = req.query as {
      project_id?: string;
      status?: string;
      parent_task_id?: string;
      assigned_agent_id?: string;
    };
    const { limit, offset } = parsePaging(req.query);
    res.json(
      listTasks(db, {
        project_id,
        status: status as TaskStatus | undefined,
        parent_task_id,
        assigned_agent_id,
        limit,
        offset,
      })
    );
  });

  router.post("/api/tasks", validateBody(createTaskSchema), (req, res) => {
    const { project_id, parent_task_id, milestone_id, assigned_agent_id, title, description, priority, status, due_date, start_date, estimate } = req.body;
    handleMutation(res, broadcast, () => createTask(db, {
      project_id,
      parent_task_id: parent_task_id ?? null,
      milestone_id: milestone_id ?? null,
      assigned_agent_id: assigned_agent_id ?? null,
      title,
      description: description ?? null,
      priority,
      status,
      due_date: due_date ?? null,
      start_date: start_date ?? null,
      estimate: estimate ?? null,
    }), "task_created", 201);
  });

  // PATCH /api/tasks/bulk (must be before :id param route)
  router.patch("/api/tasks/bulk", validateBody(bulkUpdateTasksSchema), (req, res) => {
    const { task_ids, updates } = req.body as { task_ids: string[]; updates: UpdateTaskInput };
    const tasks = bulkUpdateTasks(db, task_ids, updates);
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
      due_before: q.due_before,
      due_after: q.due_after,
    }));
  });

  router.get("/api/tasks/:id", (req, res) => {
    const task = getTask(db, req.params.id);
    if (!requireEntity(res, task, "Task")) return;
    res.json(task);
  });

  router.patch("/api/tasks/:id", validateBody(updateTaskSchema), (req, res) => {
    const task = getTask(db, req.params.id as string);
    if (!requireEntity(res, task, "Task")) return;
    const body = req.body as Parameters<typeof updateTask>[2];
    const updated = updateTask(db, req.params.id as string, body);
    broadcast({ type: "task_updated", payload: updated! });
    if (body.status && body.status !== task.status && (body.status === "done" || task.status === "blocked")) {
      for (const b of resolveBlockersForTask(db, req.params.id as string)) {
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
        source: "api",
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
    if (completed?.milestone_id) {
      recordMilestoneDailyStats(db, completed.milestone_id);
    }
    const entry = logActivity(db, {
      task_id: completed!.id,
      agent_id: null,
      message: `Completed "${completed!.title}"`,
      source: "api",
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

  return router;
}
