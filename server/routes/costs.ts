import { Router } from "express";
import type Database from "better-sqlite3";
import {
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getGlobalCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
} from "../db/index.js";
import { makeReadLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";
import { handleMutation } from "./handlers.js";
import { validateBody } from "./validate.js";
import { logCostSchema } from "../../shared/schemas.js";

const VALID_GROUP_BY = ["model", "agent", "day", "project", "milestone", "agent-summary", "global"] as const;
type GroupBy = typeof VALID_GROUP_BY[number];

export function costRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();
  const costsLimiter = makeReadLimiter(120);

  router.post("/api/costs", costsLimiter, validateBody(logCostSchema), (req, res) => {
    const { model, provider, input_tokens, output_tokens, cost_usd, agent_id, task_id, milestone_id, project_id } = req.body;
    handleMutation(res, broadcast, () => logCost(db, {
      agent_id: agent_id ?? null,
      task_id: task_id ?? null,
      milestone_id: milestone_id ?? null,
      project_id: project_id ?? null,
      model, provider, input_tokens, output_tokens, cost_usd,
    }), "cost_logged", 201);
  });

  // GET /api/costs?groupBy=model|agent|day|project|milestone|agent-summary
  //   &id=<entity-id>  &project_id=...  &milestone_id=...  &agent_id=...  &days=...
  router.get("/api/costs", costsLimiter, (req, res) => {
    const groupBy = req.query.groupBy as string | undefined;
    if (!groupBy || !VALID_GROUP_BY.includes(groupBy as GroupBy)) {
      res.status(400).json({ error: `groupBy must be one of: ${VALID_GROUP_BY.join(", ")}` });
      return;
    }
    const project_id = req.query.project_id as string | undefined;
    const milestone_id = req.query.milestone_id as string | undefined;
    const agent_id = req.query.agent_id as string | undefined;
    const id = req.query.id as string | undefined;
    const rawDays = req.query.days as string | undefined;
    let days: number | undefined;
    if (rawDays !== undefined) {
      days = parseInt(rawDays, 10);
      if (isNaN(days)) { res.status(400).json({ error: "days must be a number" }); return; }
    }

    switch (groupBy as GroupBy) {
      case "model":
        res.json(getCostByModel(db, { project_id, milestone_id }));
        break;
      case "agent":
        res.json(getCostByAgent(db, { project_id, milestone_id }));
        break;
      case "day":
        res.json(getCostTimeseries(db, { agent_id, milestone_id, project_id, days }));
        break;
      case "project": {
        const pid = id ?? project_id;
        if (!pid) { res.status(400).json({ error: "project groupBy requires id or project_id" }); return; }
        res.json(getProjectCostSummary(db, pid));
        break;
      }
      case "milestone": {
        const mid = id ?? milestone_id;
        if (!mid) { res.status(400).json({ error: "milestone groupBy requires id or milestone_id" }); return; }
        res.json(getMilestoneCostSummary(db, mid));
        break;
      }
      case "agent-summary": {
        const aid = id ?? agent_id;
        if (!aid) { res.status(400).json({ error: "agent-summary groupBy requires id or agent_id" }); return; }
        res.json(getAgentCostSummary(db, aid));
        break;
      }
      case "global":
        res.json(getGlobalCostSummary(db));
        break;
    }
  });

  return router;
}
