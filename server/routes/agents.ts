import { Router } from "express";
import rateLimit from "express-rate-limit";
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
  setAgentCostObserved,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { requireEntity } from "./handlers.js";
import { MAX_ACTIVITY_LIMIT, clampLimit } from "../constants.js";

// Marking an agent is a deliberate, occasional human action, so the ceiling
// only has to sit above real use.
const costObservedLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many agent changes, please try again later." },
});

export function agentRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
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

  /**
   * POST /api/agents/:id/cost-observed — mark an agent as already observed
   * through its transcripts, so its self-reported log_cost rows stop counting.
   *
   * Explicit by design. Nothing infers this: concluding on its own that an
   * agent is Claude Code, and then silently dropping its reported spend, is
   * precisely the guess this feature exists to avoid.
   */
  router.post("/api/agents/:id/cost-observed", costObservedLimiter, (req, res) => {
    // express.json() leaves req.body undefined without a JSON Content-Type,
    // and destructuring that throws a 500; `?? {}` keeps that case a 400.
    const { observed } = (req.body ?? {}) as { observed?: unknown };
    if (typeof observed !== "boolean") {
      return res.status(400).json({ error: "observed must be true or false" });
    }

    // Read the param once and narrow it here: with a middleware in the chain
    // Express widens req.params values to string | string[].
    const id = String(req.params.id);
    const agent = setAgentCostObserved(db, id, observed);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    broadcast({ type: "agent_registered", payload: agent });
    return res.json(agent);
  });

  return router;
}
