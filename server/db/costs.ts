import type Database from "better-sqlite3";
import { now, genId } from "./helpers.js";

export interface CostEntry {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  milestone_id: string | null;
  project_id: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface LogCostInput {
  agent_id?: string | null;
  task_id?: string | null;
  milestone_id?: string | null;
  project_id?: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface CostSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

export interface CostTimeseriesEntry {
  date: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

export function logCost(db: Database.Database, input: LogCostInput): CostEntry {
  const id = genId();
  const ts = now();
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, task_id, milestone_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agent_id ?? null,
    input.task_id ?? null,
    input.milestone_id ?? null,
    input.project_id ?? null,
    input.model,
    input.provider,
    input.input_tokens,
    input.output_tokens,
    input.cost_usd,
    ts
  );
  return db.prepare("SELECT * FROM cost_entries WHERE id = ?").get(id) as CostEntry;
}

type CostSummaryColumn = "agent_id" | "milestone_id" | "project_id";

function getCostSummaryBy(db: Database.Database, column: CostSummaryColumn, value: string): CostSummary {
  return db.prepare(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS entry_count
     FROM cost_entries WHERE ${column} = ?`
  ).get(value) as CostSummary;
}

export function getAgentCostSummary(db: Database.Database, agentId: string): CostSummary {
  return getCostSummaryBy(db, "agent_id", agentId);
}

export function getMilestoneCostSummary(db: Database.Database, milestoneId: string): CostSummary {
  return getCostSummaryBy(db, "milestone_id", milestoneId);
}

export function getProjectCostSummary(db: Database.Database, projectId: string): CostSummary {
  return getCostSummaryBy(db, "project_id", projectId);
}

export function getCostTimeseries(
  db: Database.Database,
  filter: { agent_id?: string; milestone_id?: string; project_id?: string; days?: number } = {}
): CostTimeseriesEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.agent_id) { conditions.push("agent_id = ?"); params.push(filter.agent_id); }
  if (filter.milestone_id) { conditions.push("milestone_id = ?"); params.push(filter.milestone_id); }
  if (filter.project_id) { conditions.push("project_id = ?"); params.push(filter.project_id); }

  const days = filter.days ?? 30;
  conditions.push("created_at >= ?");
  params.push(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  return db.prepare(
    `SELECT DATE(created_at) AS date,
            SUM(cost_usd) AS total_cost_usd,
            SUM(input_tokens) AS total_input_tokens,
            SUM(output_tokens) AS total_output_tokens,
            COUNT(*) AS entry_count
     FROM cost_entries
     ${where}
     GROUP BY DATE(created_at)
     ORDER BY date ASC`
  ).all(...params) as CostTimeseriesEntry[];
}

export function getCostByModel(
  db: Database.Database,
  filter: { project_id?: string; milestone_id?: string } = {}
): { model: string; provider: string; total_cost_usd: number; total_tokens: number; entry_count: number }[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.project_id) { conditions.push("project_id = ?"); params.push(filter.project_id); }
  if (filter.milestone_id) { conditions.push("milestone_id = ?"); params.push(filter.milestone_id); }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

  return db.prepare(
    `SELECT model, provider,
            SUM(cost_usd) AS total_cost_usd,
            SUM(input_tokens + output_tokens) AS total_tokens,
            COUNT(*) AS entry_count
     FROM cost_entries
     ${where}
     GROUP BY model, provider
     ORDER BY total_cost_usd DESC`
  ).all(...params) as { model: string; provider: string; total_cost_usd: number; total_tokens: number; entry_count: number }[];
}

export function getCostByAgent(
  db: Database.Database,
  filter: { project_id?: string; milestone_id?: string } = {}
): { agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number; entry_count: number }[] {
  const conditions: string[] = ["c.agent_id IS NOT NULL"];
  const params: unknown[] = [];

  if (filter.project_id) { conditions.push("c.project_id = ?"); params.push(filter.project_id); }
  if (filter.milestone_id) { conditions.push("c.milestone_id = ?"); params.push(filter.milestone_id); }

  const where = "WHERE " + conditions.join(" AND ");

  return db.prepare(
    `SELECT c.agent_id, a.name AS agent_name,
            SUM(c.cost_usd) AS total_cost_usd,
            SUM(c.input_tokens + c.output_tokens) AS total_tokens,
            COUNT(*) AS entry_count
     FROM cost_entries c
     JOIN agents a ON c.agent_id = a.id
     ${where}
     GROUP BY c.agent_id, a.name
     ORDER BY total_cost_usd DESC`
  ).all(...params) as { agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number; entry_count: number }[];
}
