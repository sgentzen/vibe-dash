import type Database from "better-sqlite3";
import { ACTIVE_THRESHOLD_MS, IDLE_THRESHOLD_MS, ACTIVE_THRESHOLD_MINUTES, SESSION_TIMEOUT_MS } from "../constants.js";
export { ACTIVE_THRESHOLD_MS, IDLE_THRESHOLD_MS, ACTIVE_THRESHOLD_MINUTES };
import type {
  Agent,
  AgentSession,
  AgentStats,
  AgentContribution,
  AgentFileLock,
  FileConflict,
  AgentHealthStatus,
  ActivityEntry,
} from "../types.js";
import { now, genId, parseAgent, normalizeAgentName } from "./helpers.js";

// ─── Agent CRUD ─────────────────────────────────────────────────────────────

export interface RegisterAgentInput {
  name: string;
  model: string | null;
  capabilities: string[];
  role?: Agent["role"];
  parent_agent_name?: string;
}

export function registerAgent(
  db: Database.Database,
  input: RegisterAgentInput
): Agent {
  const ts = now();
  const capJson = JSON.stringify(input.capabilities);
  const role = input.role ?? "agent";
  const normalized = normalizeAgentName(input.name);

  let parentAgentId: string | null = null;
  if (input.parent_agent_name) {
    const parent = getAgentByName(db, input.parent_agent_name);
    if (parent) parentAgentId = parent.id;
  }

  const existing = db
    .prepare("SELECT * FROM agents WHERE name_normalized = ?")
    .get(normalized) as Record<string, unknown> | undefined;

  let row: Record<string, unknown>;
  if (existing) {
    row = db.prepare(
      "UPDATE agents SET model = ?, capabilities = ?, role = ?, parent_agent_id = COALESCE(?, parent_agent_id), last_seen_at = ? WHERE name_normalized = ? RETURNING *"
    ).get(input.model ?? null, capJson, role, parentAgentId, ts, normalized) as Record<string, unknown>;
  } else {
    const id = genId();
    row = db.prepare(
      "INSERT INTO agents (id, name, name_normalized, model, capabilities, role, parent_agent_id, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *"
    ).get(id, input.name, normalized, input.model ?? null, capJson, role, parentAgentId, ts, ts) as Record<string, unknown>;
  }

  return parseAgent(row);
}

export function listAgents(db: Database.Database): Agent[] {
  const rows = db
    .prepare("SELECT * FROM agents ORDER BY registered_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map(parseAgent);
}

export function getAgentByName(
  db: Database.Database,
  name: string
): Agent | null {
  const normalized = normalizeAgentName(name);
  const row = db
    .prepare("SELECT * FROM agents WHERE name_normalized = ?")
    .get(normalized) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseAgent(row);
}

export function getAgentById(db: Database.Database, id: string): Agent | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return parseAgent(row);
}

export function touchAgent(db: Database.Database, name: string): Agent {
  const existing = getAgentByName(db, name);
  if (existing) {
    const timestamp = now();
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(timestamp, existing.id);
    if (existing.parent_agent_id) {
      db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(timestamp, existing.parent_agent_id);
    }
    return { ...existing, last_seen_at: timestamp };
  }
  return registerAgent(db, { name, model: null, capabilities: [] });
}

// ─── Agent Current Project ──────────────────────────────────────────────────

export function getAgentCurrentProject(
  db: Database.Database,
  agentId: string
): { project_id: string; project_name: string } | null {
  const row = db
    .prepare(
      `SELECT p.id AS project_id, p.name AS project_name
       FROM activity_log a
       JOIN tasks t ON a.task_id = t.id
       JOIN projects p ON t.project_id = p.id
       WHERE a.agent_id = ? AND t.status IN ('in_progress', 'planned')
       ORDER BY a.timestamp DESC LIMIT 1`
    )
    .get(agentId) as { project_id: string; project_name: string } | undefined;
  return row ?? null;
}

/** Batch version: returns a Map<agentId, { project_id, project_name }> for all agents at once. */
export function getAllAgentCurrentProjects(
  db: Database.Database
): Map<string, { project_id: string; project_name: string }> {
  const rows = db
    .prepare(
      `SELECT ranked.agent_id, ranked.project_id, ranked.project_name
       FROM (
         SELECT a.agent_id, p.id AS project_id, p.name AS project_name,
                ROW_NUMBER() OVER (PARTITION BY a.agent_id ORDER BY a.timestamp DESC) AS rn
         FROM activity_log a
         JOIN tasks t ON a.task_id = t.id
         JOIN projects p ON t.project_id = p.id
         WHERE t.status IN ('in_progress', 'planned')
       ) ranked
       WHERE ranked.rn = 1`
    )
    .all() as { agent_id: string; project_id: string; project_name: string }[];
  const map = new Map<string, { project_id: string; project_name: string }>();
  for (const row of rows) {
    map.set(row.agent_id, { project_id: row.project_id, project_name: row.project_name });
  }
  return map;
}

// ─── Agent Health ───────────────────────────────────────────────────────────

export function getAgentHealthStatus(lastSeenAt: string): AgentHealthStatus {
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsed < ACTIVE_THRESHOLD_MS) return "active";
  if (elapsed < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}

// ─── Agent Sessions ─────────────────────────────────────────────────────────


export function startOrGetSession(db: Database.Database, agentId: string): AgentSession {
  const ts = now();
  const open = db
    .prepare("SELECT * FROM agent_sessions WHERE agent_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1")
    .get(agentId) as AgentSession | undefined;

  if (open) {
    const elapsed = Date.now() - new Date(open.last_activity_at).getTime();
    if (elapsed > SESSION_TIMEOUT_MS) {
      db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE id = ?").run(ts, open.id);
    } else {
      return db.prepare("UPDATE agent_sessions SET activity_count = activity_count + 1, last_activity_at = ? WHERE id = ? RETURNING *").get(ts, open.id) as AgentSession;
    }
  }

  const id = genId();
  return db.prepare(
    "INSERT INTO agent_sessions (id, agent_id, started_at, last_activity_at, tasks_touched, activity_count) VALUES (?, ?, ?, ?, 1, 1) RETURNING *"
  ).get(id, agentId, ts, ts) as AgentSession;
}

export function closeAgentSessions(db: Database.Database, agentId: string): void {
  db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE agent_id = ? AND ended_at IS NULL").run(now(), agentId);
}

export function closeStaleSession(db: Database.Database): number {
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    "UPDATE agent_sessions SET ended_at = ? WHERE ended_at IS NULL AND started_at < ?"
  ).run(now(), cutoff);
  return result.changes;
}

export function cleanupStaleAgents(db: Database.Database): number {
  const cutoff = new Date(Date.now() - SESSION_TIMEOUT_MS).toISOString();
  const result = db.prepare(
    `DELETE FROM agents WHERE last_seen_at < ?
     AND id NOT IN (SELECT agent_id FROM agent_sessions WHERE ended_at IS NULL)`
  ).run(cutoff);
  return result.changes;
}

export function listAgentSessions(db: Database.Database, agentId: string): AgentSession[] {
  return db
    .prepare("SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY started_at DESC")
    .all(agentId) as AgentSession[];
}

// ─── Agent Detail ───────────────────────────────────────────────────────────

export function getAgentActivity(db: Database.Database, agentId: string, limit = 50): ActivityEntry[] {
  return db
    .prepare(
      `SELECT a.*, ag.name AS agent_name, t.title AS task_title
       FROM activity_log a
       LEFT JOIN agents ag ON a.agent_id = ag.id
       LEFT JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ?
       ORDER BY a.timestamp DESC LIMIT ?`
    )
    .all(agentId, limit) as ActivityEntry[];
}

export function getAgentCompletedToday(db: Database.Database, agentId: string): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS count FROM activity_log a
       JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ? AND t.status = 'done' AND t.updated_at >= ?`
    )
    .get(agentId, todayStart.toISOString()) as { count: number };
  return row.count;
}

// ─── Agent Performance Metrics ──────────────────────────────────────────────

export function getAgentStats(db: Database.Database, agentId: string, milestoneId?: string): AgentStats {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Counts query: completions, today, blocker rate
  const mainRow = db.prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) AS total_done,
       COUNT(DISTINCT CASE WHEN t.status = 'done' AND t.updated_at >= ? THEN t.id END) AS today_done,
       COUNT(DISTINCT t.id) AS total_tasks,
       COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM blockers b WHERE b.task_id = t.id) THEN t.id END) AS blocked_tasks
     FROM activity_log a
     JOIN tasks t ON a.task_id = t.id
     WHERE a.agent_id = ?`
  ).get(todayIso, agentId) as {
    total_done: number; today_done: number;
    total_tasks: number; blocked_tasks: number;
  };

  // Milestone-scoped completion count (separate query only when needed)
  let milestoneCompleted = 0;
  if (milestoneId) {
    const row = db.prepare(
      `SELECT COUNT(DISTINCT t.id) AS c
       FROM activity_log a JOIN tasks t ON a.task_id = t.id
       WHERE a.agent_id = ? AND t.milestone_id = ? AND t.status = 'done'`
    ).get(agentId, milestoneId) as { c: number };
    milestoneCompleted = row.c;
  }

  // Avg completion time in a separate query (subquery aggregation)
  const avgRow = db.prepare(
    `SELECT AVG(completion_sec) AS avg_sec FROM (
      SELECT (julianday(t.updated_at) - julianday(MIN(a.timestamp))) * 86400 AS completion_sec
      FROM activity_log a
      JOIN tasks t ON a.task_id = t.id
      WHERE a.agent_id = ? AND t.status = 'done'
      GROUP BY t.id
    )`
  ).get(agentId) as { avg_sec: number | null } | undefined;
  const avgCompletionTime = avgRow?.avg_sec != null ? Math.round(avgRow.avg_sec) : null;

  // Session activity frequency via SQL aggregation
  const sessionRow = db.prepare(
    `SELECT
       COALESCE(SUM(activity_count), 0) AS total_activity,
       COALESCE(SUM(
         MAX((julianday(COALESCE(ended_at, last_activity_at)) - julianday(started_at)) * 24, 0.01)
       ), 0.01) AS total_hours
     FROM agent_sessions WHERE agent_id = ?`
  ).get(agentId) as { total_activity: number; total_hours: number };
  const activityFrequency = sessionRow.total_hours > 0
    ? Math.round((sessionRow.total_activity / sessionRow.total_hours) * 10) / 10 : 0;

  const blockerRate = mainRow.total_tasks > 0 ? mainRow.blocked_tasks / mainRow.total_tasks : 0;

  return {
    agent_id: agentId,
    tasks_completed_total: mainRow.total_done,
    tasks_completed_milestone: milestoneCompleted,
    tasks_completed_today: mainRow.today_done,
    avg_completion_time_seconds: avgCompletionTime,
    blocker_rate: Math.round(blockerRate * 1000) / 1000,
    activity_frequency: activityFrequency,
  };
}

export function getMilestoneAgentContributions(db: Database.Database, milestoneId: string): AgentContribution[] {
  const rows = db.prepare(
    `SELECT agent_id, agent_name,
            SUM(completed_count) AS completed_count,
            SUM(completed_points) AS completed_points
     FROM (
       -- Primary: tasks with assigned_agent_id
       SELECT a.id AS agent_id, a.name AS agent_name,
              COUNT(t.id) AS completed_count,
              COALESCE(SUM(t.estimate), 0) AS completed_points
       FROM tasks t
       JOIN agents a ON t.assigned_agent_id = a.id
       WHERE t.milestone_id = ? AND t.status = 'done'
       GROUP BY a.id, a.name

       UNION ALL

       -- Fallback: derive agent from activity_log for unassigned tasks
       SELECT deduped.agent_id, ag.name AS agent_name,
              COUNT(*) AS completed_count,
              COALESCE(SUM(t.estimate), 0) AS completed_points
       FROM (
         SELECT DISTINCT al.agent_id, al.task_id
         FROM activity_log al
         JOIN tasks t2 ON al.task_id = t2.id
         WHERE t2.milestone_id = ? AND t2.status = 'done'
           AND t2.assigned_agent_id IS NULL
           AND al.agent_id IS NOT NULL
           AND al.message LIKE 'Completed "%'
       ) deduped
       JOIN agents ag ON deduped.agent_id = ag.id
       JOIN tasks t ON deduped.task_id = t.id
       GROUP BY deduped.agent_id, ag.name
     )
     GROUP BY agent_id, agent_name
     ORDER BY completed_count DESC`
  ).all(milestoneId, milestoneId) as AgentContribution[];
  return rows;
}

// ─── Agent File Locks ───────────────────────────────────────────────────────

export function reportWorkingOn(
  db: Database.Database,
  agentId: string,
  taskId: string,
  filePaths: string[]
): AgentFileLock[] {
  const ts = now();
  const locks: AgentFileLock[] = [];
  for (const fp of filePaths) {
    const id = genId();
    const row = db.prepare(
      "INSERT OR REPLACE INTO agent_file_locks (id, agent_id, task_id, file_path, started_at) VALUES (?, ?, ?, ?, ?) RETURNING *"
    ).get(id, agentId, taskId, fp, ts) as AgentFileLock;
    locks.push(row);
  }
  return locks;
}

export function releaseFileLocks(db: Database.Database, agentId: string, taskId?: string): number {
  if (taskId) {
    return db.prepare("DELETE FROM agent_file_locks WHERE agent_id = ? AND task_id = ?").run(agentId, taskId).changes;
  }
  return db.prepare("DELETE FROM agent_file_locks WHERE agent_id = ?").run(agentId).changes;
}

export function getActiveFileLocks(db: Database.Database): AgentFileLock[] {
  return db.prepare("SELECT * FROM agent_file_locks ORDER BY started_at DESC").all() as AgentFileLock[];
}

export function getFileConflicts(db: Database.Database): FileConflict[] {
  const rows = db.prepare(
    `SELECT fl.file_path, fl.agent_id, a.name AS agent_name, fl.task_id
     FROM agent_file_locks fl
     JOIN agents a ON fl.agent_id = a.id
     WHERE fl.file_path IN (
       SELECT file_path FROM agent_file_locks GROUP BY file_path HAVING COUNT(DISTINCT agent_id) > 1
     )
     ORDER BY fl.file_path, a.name`
  ).all() as { file_path: string; agent_id: string; agent_name: string; task_id: string }[];

  const map = new Map<string, FileConflict>();
  for (const row of rows) {
    if (!map.has(row.file_path)) {
      map.set(row.file_path, { file_path: row.file_path, agents: [] });
    }
    map.get(row.file_path)!.agents.push({
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      task_id: row.task_id,
    });
  }
  return [...map.values()];
}
