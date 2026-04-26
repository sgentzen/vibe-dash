import type Database from "better-sqlite3";
import type { ActivityEntry, ActivityHeatmapEntry } from "../types.js";
import { now, genId } from "./helpers.js";
import { buildWhere } from "./where.js";

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
  const row = db.prepare(
    "INSERT INTO activity_log (id, task_id, agent_id, message, timestamp) VALUES (?, ?, ?, ?, ?) RETURNING *"
  ).get(id, input.task_id, input.agent_id ?? null, input.message, ts) as ActivityEntry;
  if (input.agent_id) {
    db.prepare(
      `UPDATE agents SET last_seen_at = ?
         WHERE id = (SELECT parent_agent_id FROM agents WHERE id = ?)`
    ).run(ts, input.agent_id);
  }
  return row;
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
  const { sql: where, params } = buildWhere([
    filter.agent_id ? ["a.agent_id = ?", filter.agent_id] : null,
    filter.project_id
      ? ["a.task_id IN (SELECT id FROM tasks WHERE project_id = ?)", filter.project_id]
      : null,
    filter.since ? ["a.timestamp >= ?", filter.since] : null,
  ]);

  const sql = `SELECT a.id, a.task_id, a.agent_id, a.message, a.timestamp,
       ag.name AS agent_name, t.title AS task_title,
       p.name AS project_name, p.id AS project_id,
       parent_ag.name AS parent_agent_name
     FROM activity_log a
     LEFT JOIN agents ag ON a.agent_id = ag.id
     LEFT JOIN agents parent_ag ON ag.parent_agent_id = parent_ag.id
     LEFT JOIN tasks t ON a.task_id = t.id
     LEFT JOIN projects p ON t.project_id = p.id
     ${where}
     ORDER BY a.timestamp DESC LIMIT ?`;
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
