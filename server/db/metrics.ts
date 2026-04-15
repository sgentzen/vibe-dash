import type Database from "better-sqlite3";
import { now, genId } from "./helpers.js";

export interface CompletionMetrics {
  id: string;
  task_id: string;
  agent_id: string;
  lines_added: number;
  lines_removed: number;
  files_changed: number;
  tests_added: number;
  tests_passing: number;
  duration_seconds: number;
  created_at: string;
}

export interface LogCompletionMetricsInput {
  task_id: string;
  agent_id: string;
  lines_added?: number;
  lines_removed?: number;
  files_changed?: number;
  tests_added?: number;
  tests_passing?: number;
  duration_seconds?: number;
}

export interface AgentPerformance {
  agent_id: string;
  agent_name: string;
  tasks_completed: number;
  total_lines_added: number;
  total_lines_removed: number;
  total_files_changed: number;
  total_tests_added: number;
  avg_duration_seconds: number;
  avg_lines_per_task: number;
  avg_tests_per_task: number;
}

export interface AgentComparison {
  agents: AgentPerformance[];
}

export interface TaskTypeBreakdown {
  priority: string;
  count: number;
  avg_duration_seconds: number;
  avg_lines_added: number;
}

export function logCompletionMetrics(db: Database.Database, input: LogCompletionMetricsInput): CompletionMetrics {
  const id = genId();
  const ts = now();
  db.prepare(
    `INSERT INTO completion_metrics (id, task_id, agent_id, lines_added, lines_removed, files_changed, tests_added, tests_passing, duration_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.task_id,
    input.agent_id,
    input.lines_added ?? 0,
    input.lines_removed ?? 0,
    input.files_changed ?? 0,
    input.tests_added ?? 0,
    input.tests_passing ?? 0,
    input.duration_seconds ?? 0,
    ts,
  );
  return db.prepare("SELECT * FROM completion_metrics WHERE id = ?").get(id) as CompletionMetrics;
}

export function getAgentPerformance(db: Database.Database, agentId: string): AgentPerformance | null {
  const row = db.prepare(`
    SELECT
      cm.agent_id,
      a.name AS agent_name,
      COUNT(*) AS tasks_completed,
      SUM(cm.lines_added) AS total_lines_added,
      SUM(cm.lines_removed) AS total_lines_removed,
      SUM(cm.files_changed) AS total_files_changed,
      SUM(cm.tests_added) AS total_tests_added,
      AVG(cm.duration_seconds) AS avg_duration_seconds,
      AVG(cm.lines_added) AS avg_lines_per_task,
      AVG(cm.tests_added) AS avg_tests_per_task
    FROM completion_metrics cm
    JOIN agents a ON a.id = cm.agent_id
    WHERE cm.agent_id = ?
    GROUP BY cm.agent_id
  `).get(agentId) as AgentPerformance | undefined;
  return row ?? null;
}

export function getAgentComparison(db: Database.Database): AgentComparison {
  const agents = db.prepare(`
    SELECT
      cm.agent_id,
      a.name AS agent_name,
      COUNT(*) AS tasks_completed,
      SUM(cm.lines_added) AS total_lines_added,
      SUM(cm.lines_removed) AS total_lines_removed,
      SUM(cm.files_changed) AS total_files_changed,
      SUM(cm.tests_added) AS total_tests_added,
      AVG(cm.duration_seconds) AS avg_duration_seconds,
      AVG(cm.lines_added) AS avg_lines_per_task,
      AVG(cm.tests_added) AS avg_tests_per_task
    FROM completion_metrics cm
    JOIN agents a ON a.id = cm.agent_id
    GROUP BY cm.agent_id
    ORDER BY tasks_completed DESC
  `).all() as AgentPerformance[];
  return { agents };
}

export function getTaskTypeBreakdown(db: Database.Database, agentId: string): TaskTypeBreakdown[] {
  return db.prepare(`
    SELECT
      t.priority,
      COUNT(*) AS count,
      AVG(cm.duration_seconds) AS avg_duration_seconds,
      AVG(cm.lines_added) AS avg_lines_added
    FROM completion_metrics cm
    JOIN tasks t ON t.id = cm.task_id
    WHERE cm.agent_id = ?
    GROUP BY t.priority
    ORDER BY count DESC
  `).all(agentId) as TaskTypeBreakdown[];
}
