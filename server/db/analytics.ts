import type Database from "better-sqlite3";

export type MilestoneHealthStatus = "on_track" | "at_risk" | "behind";

export interface MilestoneHealth {
  id: string;
  name: string;
  target_date: string | null;
  task_count: number;
  completed_count: number;
  completion_pct: number;
  health: MilestoneHealthStatus;
}

export interface TeamUtilization {
  total: number;
  active: number;
  idle: number;
  offline: number;
}

export interface BlockersSummary {
  open_count: number;
  avg_resolution_seconds: number | null;
}

export interface TaskVelocity {
  this_week: number;
  last_week: number;
  trend_pct: number | null;
}

export interface CostTrendEntry {
  date: string;
  cost_usd: number;
}

export interface CostOverview {
  total_cost_usd: number;
  last_7_days_cost_usd: number;
  daily_trend: CostTrendEntry[];
}

export interface ExecutiveSummary {
  project_id: string;
  project_name: string;
  milestone_health: MilestoneHealth[];
  team_utilization: TeamUtilization;
  blockers: BlockersSummary;
  velocity: TaskVelocity;
  costs: CostOverview;
  generated_at: string;
}

function getMilestoneHealth(db: Database.Database, projectId: string): MilestoneHealth[] {
  const milestones = db.prepare(
    "SELECT id, name, target_date FROM milestones WHERE project_id = ? AND status = 'open' ORDER BY target_date ASC NULLS LAST"
  ).all(projectId) as { id: string; name: string; target_date: string | null }[];

  const now = new Date();

  return milestones.map((m) => {
    const counts = db.prepare(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as done FROM tasks WHERE milestone_id = ?"
    ).get(m.id) as { total: number; done: number };

    const total = counts.total || 0;
    const done = counts.done || 0;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    let health: MilestoneHealthStatus = "on_track";
    if (m.target_date) {
      const daysLeft = (new Date(m.target_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      const remaining = total - done;
      if (daysLeft < 0) {
        health = remaining > 0 ? "behind" : "on_track";
      } else if (remaining > 0 && daysLeft < remaining * 0.5) {
        health = "at_risk";
      }
    }

    return {
      id: m.id,
      name: m.name,
      target_date: m.target_date,
      task_count: total,
      completed_count: done,
      completion_pct: pct,
      health,
    };
  });
}

function getTeamUtilization(db: Database.Database): TeamUtilization {
  const ACTIVE_THRESHOLD_MINUTES = 5;
  const IDLE_THRESHOLD_MINUTES = 30;
  const rows = db.prepare("SELECT last_seen_at FROM agents").all() as { last_seen_at: string }[];
  const now = Date.now();
  let active = 0, idle = 0, offline = 0;
  for (const { last_seen_at } of rows) {
    const diffMs = now - new Date(last_seen_at).getTime();
    const diffMin = diffMs / 60000;
    if (diffMin <= ACTIVE_THRESHOLD_MINUTES) active++;
    else if (diffMin <= IDLE_THRESHOLD_MINUTES) idle++;
    else offline++;
  }
  return { total: rows.length, active, idle, offline };
}

function getBlockersSummary(db: Database.Database, projectId: string): BlockersSummary {
  const open = db.prepare(
    `SELECT COUNT(*) as cnt FROM blockers b
     JOIN tasks t ON b.task_id = t.id
     WHERE t.project_id = ? AND b.resolved_at IS NULL`
  ).get(projectId) as { cnt: number };

  const resolved = db.prepare(
    `SELECT AVG((julianday(b.resolved_at) - julianday(b.reported_at)) * 86400) as avg_secs
     FROM blockers b
     JOIN tasks t ON b.task_id = t.id
     WHERE t.project_id = ? AND b.resolved_at IS NOT NULL`
  ).get(projectId) as { avg_secs: number | null };

  return {
    open_count: open.cnt,
    avg_resolution_seconds: resolved.avg_secs ?? null,
  };
}

function getTaskVelocity(db: Database.Database, projectId: string): TaskVelocity {
  const thisWeekStart = new Date();
  thisWeekStart.setDate(thisWeekStart.getDate() - 7);
  const lastWeekStart = new Date();
  lastWeekStart.setDate(lastWeekStart.getDate() - 14);

  const thisWeek = (db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ? AND status = 'done' AND updated_at >= ?"
  ).get(projectId, thisWeekStart.toISOString()) as { cnt: number }).cnt;

  const lastWeek = (db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE project_id = ? AND status = 'done' AND updated_at >= ? AND updated_at < ?"
  ).get(projectId, lastWeekStart.toISOString(), thisWeekStart.toISOString()) as { cnt: number }).cnt;

  const trend = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  return { this_week: thisWeek, last_week: lastWeek, trend_pct: trend };
}

function getCostOverview(db: Database.Database, projectId: string): CostOverview {
  const total = (db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE project_id = ?"
  ).get(projectId) as { total: number }).total;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const last7 = (db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_entries WHERE project_id = ? AND created_at >= ?"
  ).get(projectId, weekAgo.toISOString()) as { total: number }).total;

  const trend = db.prepare(
    `SELECT substr(created_at, 1, 10) as date, SUM(cost_usd) as cost_usd
     FROM cost_entries WHERE project_id = ? AND created_at >= ?
     GROUP BY substr(created_at, 1, 10)
     ORDER BY date ASC`
  ).all(projectId, weekAgo.toISOString()) as CostTrendEntry[];

  return {
    total_cost_usd: total,
    last_7_days_cost_usd: last7,
    daily_trend: trend,
  };
}

export function getExecutiveSummary(
  db: Database.Database,
  projectId: string
): ExecutiveSummary | null {
  const project = db.prepare("SELECT id, name FROM projects WHERE id = ?")
    .get(projectId) as { id: string; name: string } | undefined;
  if (!project) return null;

  return {
    project_id: project.id,
    project_name: project.name,
    milestone_health: getMilestoneHealth(db, projectId),
    team_utilization: getTeamUtilization(db),
    blockers: getBlockersSummary(db, projectId),
    velocity: getTaskVelocity(db, projectId),
    costs: getCostOverview(db, projectId),
    generated_at: new Date().toISOString(),
  };
}
