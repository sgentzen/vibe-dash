import { Router } from "express";
import type Database from "better-sqlite3";
import rateLimit from "express-rate-limit";
import { createTask, logActivity } from "../db/index.js";
import type { TaskPriority } from "../types.js";
import type { BroadcastFn, RouteFactory } from "./types.js";
import { badRequest } from "./responses.js";

type IncomingAlert = {
  source: "pagerduty" | "sentry" | "grafana" | "generic";
  external_id?: string | null;
  title: string;
  description?: string | null;
  severity?: string | null;
};

function mapSeverity(source: IncomingAlert["source"], severity?: string | null): TaskPriority {
  const s = (severity ?? "").toLowerCase();
  if (!s) return "medium";

  if (source === "pagerduty") {
    if (s === "critical") return "urgent";
    if (s === "error") return "high";
    if (s === "warning") return "medium";
    return "low";
  }
  if (source === "sentry") {
    if (s === "fatal") return "urgent";
    if (s === "error") return "high";
    if (s === "warning") return "medium";
    return "low";
  }
  if (source === "grafana") {
    if (s === "critical" || s === "alerting") return "high";
    if (s === "warning" || s === "pending") return "medium";
    if (s === "ok" || s === "resolved") return "low";
    return "medium";
  }
  if (s === "urgent" || s === "critical" || s === "fatal") return "urgent";
  if (s === "high" || s === "error") return "high";
  if (s === "low" || s === "info") return "low";
  return "medium";
}

function parsePagerDuty(body: Record<string, unknown>): IncomingAlert | null {
  const event = (body.event ?? body) as Record<string, unknown> | undefined;
  if (!event) return null;
  const data = (event.data ?? event) as Record<string, unknown>;
  const title = (data.title as string) ?? (data.summary as string) ?? null;
  if (!title) return null;
  return {
    source: "pagerduty",
    external_id: (data.id as string) ?? null,
    title,
    description: (data.description as string) ?? null,
    severity: (data.severity as string) ?? null,
  };
}

function parseSentry(body: Record<string, unknown>): IncomingAlert | null {
  const data = (body.data ?? body) as Record<string, unknown>;
  const issue = (data.issue ?? data) as Record<string, unknown>;
  const title = (issue.title as string) ?? (body.message as string) ?? null;
  if (!title) return null;
  return {
    source: "sentry",
    external_id: (issue.id as string) ?? (issue.short_id as string) ?? null,
    title,
    description: (issue.culprit as string) ?? (issue.metadata && typeof issue.metadata === "object" ? JSON.stringify(issue.metadata) : (issue.metadata as string)) ?? null,
    severity: (issue.level as string) ?? (body.level as string) ?? null,
  };
}

function parseGrafana(body: Record<string, unknown>): IncomingAlert | null {
  const title = (body.title as string) ?? (body.ruleName as string) ?? (body.message as string);
  if (!title) return null;
  return {
    source: "grafana",
    external_id: (body.ruleId as string) ?? (body.alertId as string) ?? null,
    title,
    description: (body.message as string) ?? null,
    severity: (body.state as string) ?? null,
  };
}

function parseGeneric(body: Record<string, unknown>): IncomingAlert | null {
  const title = body.title as string | undefined;
  if (!title) return null;
  return {
    source: "generic",
    external_id: (body.id as string) ?? null,
    title,
    description: (body.description as string) ?? null,
    severity: (body.severity as string) ?? null,
  };
}

export const integrationRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  const integrationLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  function ingest(
    source: IncomingAlert["source"],
    parser: (body: Record<string, unknown>) => IncomingAlert | null,
  ) {
    return (req: import("express").Request, res: import("express").Response) => {
      const projectId = req.query.project_id as string | undefined;
      if (!projectId) { badRequest(res, "project_id query parameter is required"); return; }
      const projectRow = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
      if (!projectRow) { badRequest(res, "project not found"); return; }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const alert = parser(body);
      if (!alert) { badRequest(res, `invalid ${source} payload: missing title`); return; }

      const priority = mapSeverity(alert.source, alert.severity);
      const assignedAgentId = (req.query.assigned_agent_id as string | undefined) ?? null;
      if (assignedAgentId) {
        const agentRow = db.prepare("SELECT id FROM agents WHERE id = ?").get(assignedAgentId);
        if (!agentRow) { badRequest(res, "assigned_agent_id not found"); return; }
      }
      const title = `[${alert.source}] ${alert.title}`.slice(0, 500);
      const descParts = [
        alert.description ?? "",
        alert.external_id ? `\nexternal_id: ${alert.external_id}` : "",
        alert.severity ? `\nseverity: ${alert.severity}` : "",
      ].filter(Boolean);

      const task = createTask(db, {
        project_id: projectId,
        title,
        description: descParts.join("") || null,
        priority,
        assigned_agent_id: assignedAgentId,
      });
      logActivity(db, {
        task_id: task.id,
        agent_id: null,
        message: `Auto-created from ${source} alert${alert.external_id ? ` (${alert.external_id})` : ""}`,
      });
      broadcast({ type: "task_created", payload: task });
      res.status(201).json({ task, alert });
    };
  }

  router.post("/api/integrations/pagerduty", integrationLimiter, ingest("pagerduty", parsePagerDuty));
  router.post("/api/integrations/sentry", integrationLimiter, ingest("sentry", parseSentry));
  router.post("/api/integrations/grafana", integrationLimiter, ingest("grafana", parseGrafana));
  router.post("/api/integrations/generic", integrationLimiter, ingest("generic", parseGeneric));

  return router;
};
