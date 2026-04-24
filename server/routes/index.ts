import { Router } from "express";
import type Database from "better-sqlite3";
import { broadcast as wsBroadcast } from "../websocket.js";
import { fireWebhooks } from "../db/index.js";
import { logger } from "../logger.js";
import type { WsEvent } from "../types.js";
import { systemRoutes } from "./system.js";
import { projectRoutes } from "./projects.js";
import { taskRoutes } from "./tasks.js";
import { agentRoutes } from "./agents.js";
import { activityRoutes } from "./activity.js";
import { blockerRoutes } from "./blockers.js";
import { tagRoutes } from "./tags.js";
import { dependencyRoutes } from "./dependencies.js";
import { commentRoutes } from "./comments.js";
import { fileLockRoutes } from "./file-locks.js";
import { alertRoutes } from "./alerts.js";
import { notificationRoutes } from "./notifications.js";
import { filterRoutes } from "./filters.js";
import { templateRoutes } from "./templates.js";
import { webhookRoutes } from "./webhooks.js";
import { costRoutes } from "./costs.js";
import { metricRoutes } from "./metrics.js";
import { bulkRoutes } from "./bulk.js";
import { reviewRoutes } from "./reviews.js";
import { worktreeRoutes } from "./worktrees.js";
import { executiveRoutes } from "./executive.js";
import { milestoneRoutes } from "./milestones.js";
import type { RouteFactory } from "./types.js";

function makeBroadcast(db: Database.Database) {
  return (event: WsEvent) => {
    wsBroadcast(event);
    fireWebhooks(db, event.type, event.payload).catch((err) => {
      logger.warn({ err, event: event.type }, "webhook dispatch failed");
    });
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
  tagRoutes,
  dependencyRoutes,
  commentRoutes,
  fileLockRoutes,
  alertRoutes,
  notificationRoutes,
  filterRoutes,
  templateRoutes,
  webhookRoutes,
  costRoutes,
  bulkRoutes,
  reviewRoutes,
  worktreeRoutes,
  executiveRoutes,
  milestoneRoutes,
];

export function createRouter(db: Database.Database): Router {
  const broadcast = makeBroadcast(db);
  const router = Router();

  for (const factory of routeFactories) {
    router.use(factory(db, broadcast));
  }

  return router;
}
