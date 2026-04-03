import type Database from "better-sqlite3";
import type { ActivityEntry, ActivityHeatmapEntry } from "../types.js";
import { now, genId } from "./helpers.js";

export interface LogActivityInput {
  task_id: string;
  agent_id: string | null;
  message: string;
}

export function logActivity(
  db: Database.Database,
  input: LogActivityInput
): ActivityEntry {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(id, input.task_id, input.agent_id ?? null, input.message, ts);
  if (input.agent_id) {
    const agent = db.prepare("SELECT parent_agent_id FROM agents WHERE id = ?").get(input.agent_id) as { parent_agent_id: string | null } | undefined;
    if (agent?.parent_agent_id) {
      db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(ts, agent.parent_agent_id);
    }
  }
  return db
    .prepare("SELECT * FROM activity_log WHERE id = ?")
    .get(id) as ActivityEntry;
}

export function getRecentActivity(
  db: Database.Database,
  limit: number
): ActivityEntry[] {
  return db
    .prepare(
      `SELECT a.*, ag.name AS agent_name, t.title AS task_title
       FROM activity_log a
       LEFT JOIN agents ag ON a.agent_id = ag.id
       LEFT JOIN tasks t ON a.task_id = t.id
       ORDER BY a.timestamp DESC LIMIT ?`
    )
    .all(limit) as ActivityEntry[];
}

export function getAgentCurrentTask(
  db: Database.Database,
  agentId: string
): string | null {
  const row = db
    .prepare(
      `SELECT t.title FROM activity_log a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ? AND t.status IN ('in_progress', 'planned')
       ORDER BY a.timestamp DESC LIMIT 1`
    )
    .get(agentId) as { title: string } | undefined;
  return row?.title ?? null;
}

// ─── Activity Stream ────────────────────────────────────────────────────────

export interface ActivityStreamFilter {
  agent_id?: string;
  project_id?: string;
  since?: string;
  limit?: number;
}

export function getActivityStream(db: Database.Database, filter: ActivityStreamFilter = {}): ActivityEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) { conditions.push("a.agent_id = ?"); params.push(filter.agent_id); }
  if (filter.project_id) {
    conditions.push("a.task_id IN (SELECT id FROM tasks WHERE project_id = ?)");
    params.push(filter.project_id);
  }
  if (filter.since) { conditions.push("a.timestamp >= ?"); params.push(filter.since); }

  let sql = `SELECT a.*, ag.name AS agent_name, t.title AS task_title
     FROM activity_log a
     LEFT JOIN agents ag ON a.agent_id = ag.id
     LEFT JOIN tasks t ON a.task_id = t.id`;
  if (conditions.length > 0) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY a.timestamp DESC LIMIT ?";
  params.push(filter.limit ?? 100);

  return db.prepare(sql).all(...params) as ActivityEntry[];
}

// ─── Activity Heatmap ───────────────────────────────────────────────────────

export function getAgentActivityHeatmap(db: Database.Database, projectId?: string): ActivityHeatmapEntry[] {
  const whereClause = projectId
    ? `WHERE t.project_id = ?`
    : "";
  const params = projectId ? [projectId] : [];
  return db.prepare(
    `SELECT CAST(strftime('%H', a.timestamp) AS INTEGER) AS hour,
       a.agent_id, ag.name AS agent_name, COUNT(*) AS count
     FROM activity_log a
     JOIN agents ag ON a.agent_id = ag.id
     LEFT JOIN tasks t ON a.task_id = t.id
     ${whereClause}
     GROUP BY hour, a.agent_id, ag.name
     ORDER BY hour ASC, count DESC`
  ).all(...params) as ActivityHeatmapEntry[];
}
