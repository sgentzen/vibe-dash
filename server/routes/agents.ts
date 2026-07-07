import { Router } from "express";
import type Database from "better-sqlite3";
import {
  listAgents,
  getAgentById,
  getAgentCurrentTask,
  getAgentCurrentProject,
  getAllAgentCurrentProjects,
  getAgentHealthStatus,
  getAgentActivity,
  getAgentCompletedToday,
  listAgentSessions,
  getAgentStats,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { requireEntity } from "./handlers.js";
import { MAX_ACTIVITY_LIMIT, clampLimit } from "../constants.js";

export function agentRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/agents", (_req, res) => {
    const agents = listAgents(db);
    const projectMap = getAllAgentCurrentProjects(db);
    const withStatus = agents.map((a) => {
      const health_status = getAgentHealthStatus(a.last_seen_at);
      const project = projectMap.get(a.id);
      return {
        ...a,
        health_status,
        active: health_status === "active",
        completed_today: getAgentCompletedToday(db, a.id),
        current_task_title: getAgentCurrentTask(db, a.id),
        current_project_id: project?.project_id ?? null,
        current_project_name: project?.project_name ?? null,
      };
    });
    res.json(withStatus);
  });

  router.get("/api/agents/:id", (req, res) => {
    const agent = getAgentById(db, req.params.id);
    if (!requireEntity(res, agent, "Agent")) return;
    const project = getAgentCurrentProject(db, agent.id);
    res.json({
      ...agent,
      health_status: getAgentHealthStatus(agent.last_seen_at),
      completed_today: getAgentCompletedToday(db, agent.id),
      current_task_title: getAgentCurrentTask(db, agent.id),
      current_project_id: project?.project_id ?? null,
      current_project_name: project?.project_name ?? null,
    });
  });

  router.get("/api/agents/:id/activity", (req, res) => {
    res.json(getAgentActivity(db, req.params.id, clampLimit(req.query.limit, 50, MAX_ACTIVITY_LIMIT)));
  });

  router.get("/api/agents/:id/sessions", (req, res) => {
    res.json(listAgentSessions(db, req.params.id));
  });

  router.get("/api/agents/:id/stats", (req, res) => {
    const sprintId = req.query.sprint_id as string | undefined;
    res.json(getAgentStats(db, req.params.id, sprintId));
  });

  return router;
}
