import { Router } from "express";
import type Database from "better-sqlite3";
import { broadcast as wsBroadcast } from "../websocket.js";
import type { WsEvent } from "../types.js";
import { systemRoutes } from "./system.js";
import { projectRoutes } from "./projects.js";
import { taskRoutes } from "./tasks.js";
import { agentRoutes } from "./agents.js";
import { activityRoutes } from "./activity.js";
import { blockerRoutes } from "./blockers.js";
import { dependencyRoutes } from "./dependencies.js";
import { commentRoutes } from "./comments.js";
import { notificationRoutes } from "./notifications.js";
import { costRoutes } from "./costs.js";
import { metricRoutes } from "./metrics.js";
import { bulkRoutes } from "./bulk.js";
import { worktreeRoutes } from "./worktrees.js";
import { milestoneRoutes } from "./milestones.js";
import type { RouteFactory } from "./types.js";
import rateLimit from "express-rate-limit";

// The dashboard polls every 3s, with the active view firing ad-hoc requests on
// top of that (executive summary, milestone daily stats, contributions, cost
// charts). A 1500/15min budget was tight enough that a single tab could hit it
// and cascade visible 429s ("Failed to load executive summary"). 10000/15min
// (~11 req/s) leaves comfortable headroom for multiple tabs.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

function makeBroadcast(_db: Database.Database) {
  return (event: WsEvent) => {
    wsBroadcast(event);
  };
}

const routeFactories: RouteFactory[] = [
  systemRoutes,
  projectRoutes,
  taskRoutes,
  metricRoutes,
  agentRoutes,
  activityRoutes,
  blockerRoutes,
  dependencyRoutes,
  commentRoutes,
  notificationRoutes,
  costRoutes,
  bulkRoutes,
  worktreeRoutes,
  milestoneRoutes,
];

export function createRouter(db: Database.Database): Router {
  const broadcast = makeBroadcast(db);
  const router = Router();

  // Global rate limit — applies to all API routes
  router.use(apiLimiter);

  for (const factory of routeFactories) {
    router.use(factory(db, broadcast));
  }

  return router;
}
