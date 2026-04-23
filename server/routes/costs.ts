import { Router } from "express";
import type Database from "better-sqlite3";
import {
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
} from "../db/index.js";
import { statsLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { validateBody } from "./validate.js";
import { logCostSchema } from "../../shared/schemas.js";

export function costRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.post("/api/costs", statsLimiter, validateBody(logCostSchema), (req, res) => {
    const { model, provider, input_tokens, output_tokens, cost_usd, agent_id, task_id, milestone_id, project_id } = req.body;
    const entry = logCost(db, {
      agent_id: agent_id ?? null,
      task_id: task_id ?? null,
      milestone_id: milestone_id ?? null,
      project_id: project_id ?? null,
      model, provider, input_tokens, output_tokens, cost_usd,
    });
    broadcast({ type: "cost_logged", payload: entry });
    res.status(201).json(entry);
  });

  router.get("/api/costs/agent/:agentId", (req, res) => {
    res.json(getAgentCostSummary(db, req.params.agentId));
  });

  router.get("/api/costs/milestone/:milestoneId", (req, res) => {
    res.json(getMilestoneCostSummary(db, req.params.milestoneId));
  });

  router.get("/api/costs/project/:projectId", (req, res) => {
    res.json(getProjectCostSummary(db, req.params.projectId));
  });

  router.get("/api/costs/timeseries", (req, res) => {
    const agent_id = req.query.agent_id as string | undefined;
    const milestone_id = req.query.milestone_id as string | undefined;
    const project_id = req.query.project_id as string | undefined;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;
    res.json(getCostTimeseries(db, { agent_id, milestone_id, project_id, days }));
  });

  router.get("/api/costs/by-model", (req, res) => {
    const project_id = req.query.project_id as string | undefined;
    const milestone_id = req.query.milestone_id as string | undefined;
    res.json(getCostByModel(db, { project_id, milestone_id }));
  });

  router.get("/api/costs/by-agent", (req, res) => {
    const project_id = req.query.project_id as string | undefined;
    const milestone_id = req.query.milestone_id as string | undefined;
    res.json(getCostByAgent(db, { project_id, milestone_id }));
  });

  return router;
}
