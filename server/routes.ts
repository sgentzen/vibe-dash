import { Router } from "express";
import type Database from "better-sqlite3";
import type { TaskStatus } from "./types.js";
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
} from "./db.js";
import { broadcast } from "./websocket.js";

export function createRouter(db: Database.Database): Router {
  const router = Router();

  // GET /api/stats
  router.get("/api/stats", (_req, res) => {
    const projects = (
      db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
        count: number;
      }
    ).count;
    const tasks = (
      db.prepare("SELECT COUNT(*) AS count FROM tasks").get() as {
        count: number;
      }
    ).count;
    const activeAgents = (
      db.prepare("SELECT COUNT(*) AS count FROM agents").get() as {
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
    const { project_id, status, parent_task_id } = req.query as {
      project_id?: string;
      status?: string;
      parent_task_id?: string;
    };
    res.json(
      listTasks(db, {
        project_id,
        status: status as TaskStatus | undefined,
        parent_task_id,
      })
    );
  });

  // POST /api/tasks
  router.post("/api/tasks", (req, res) => {
    const { project_id, parent_task_id, title, description, priority, status } =
      req.body as {
        project_id: string;
        parent_task_id?: string | null;
        title: string;
        description?: string | null;
        priority: string;
        status?: string;
      };
    if (!project_id || !title || !priority) {
      res.status(400).json({ error: "project_id, title, and priority are required" });
      return;
    }
    const task = createTask(db, {
      project_id,
      parent_task_id: parent_task_id ?? null,
      title,
      description: description ?? null,
      priority: priority as Parameters<typeof createTask>[1]["priority"],
      status: status as Parameters<typeof createTask>[1]["status"],
    });
    broadcast({ type: "task_created", payload: task });
    res.status(201).json(task);
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
    const updated = updateTask(db, req.params.id, req.body as Parameters<typeof updateTask>[2]);
    broadcast({ type: "task_updated", payload: updated! });
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
    res.json(completed);
  });

  // GET /api/agents
  router.get("/api/agents", (_req, res) => {
    res.json(listAgents(db));
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

  return router;
}
