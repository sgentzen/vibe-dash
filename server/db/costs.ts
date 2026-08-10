import type Database from "better-sqlite3";
import { now, genId } from "./helpers.js";
import { buildWhere } from "./where.js";
import type {
  CostEntry,
  CostSummary,
  CostTimeseriesEntry,
  CostByModelEntry,
  CostByAgentEntry,
} from "../../shared/types.js";

export type { CostEntry, CostSummary, CostTimeseriesEntry, CostByModelEntry, CostByAgentEntry };

/**
 * The two SQL fragments every aggregate below needs, as functions because
 * `getCostByAgent` joins and so has to qualify the column.
 *
 * COALESCE on the total is not cosmetic. cost_usd is nullable by design (an
 * unpriced model stores NULL, never 0) and SQL SUM skips NULLs, so a group
 * whose rows are all unpriced sums to NULL. Emitting that reaches the dashboard
 * as `null.toFixed(4)`, which throws, and with no ErrorBoundary in the tree it
 * takes every other card down with it. Every total is floored at the query.
 *
 * The unpriced count is the honesty half of the same problem: flooring the
 * total makes a group of unpriced rows look like $0.00 of genuine spend. This
 * count is how a caller can tell "cheap" from "not known".
 */
const totalCostSql = (prefix = ""): string => `COALESCE(SUM(${prefix}cost_usd), 0) AS total_cost_usd`;
const unpricedSql = (prefix = ""): string =>
  `COALESCE(SUM(CASE WHEN ${prefix}cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_entries`;

/**
 * Rows an observed agent self-reported, which duplicate what we already read
 * from its transcripts.
 *
 * Only `mcp` rows are excluded: the `transcript` row is the observation we
 * trust, and dropping it would delete the very figure that replaced the
 * duplicate. A row with a NULL agent_id is never excluded either, because a
 * self-report that named no agent cannot be attributed to one — that is the
 * documented limitation.
 *
 * The `agent_id IS NOT NULL` guard is load-bearing and must not be removed as
 * redundant. `NULL IN (<non-empty subquery>)` evaluates to NULL, not FALSE, so
 * without it `NOT (... AND NULL)` is NULL, a WHERE clause treats that as
 * not-true, and every self-report that named no agent would vanish from the
 * totals as soon as any agent was marked. Those rows are unattributable and so
 * cannot be excluded by agent; they must stay counted.
 *
 * A named constant rather than a string repeated at six call sites, so a query
 * added later cannot silently reintroduce double counting.
 */
const excludeObservedCondition = (prefix = ""): string =>
  `NOT (${prefix}source = 'mcp' ` +
  `AND ${prefix}agent_id IS NOT NULL ` +
  `AND ${prefix}agent_id IN (SELECT id FROM agents WHERE cost_observed_externally = 1))`;

/**
 * Compose the exclusion onto a WHERE clause that may or may not exist.
 *
 * buildWhere() cannot carry this: it pushes a parameter for every clause it
 * accepts, and this condition takes none.
 */
const withExclusion = (existingWhere: string, prefix = ""): string =>
  existingWhere.length > 0
    ? `${existingWhere} AND ${excludeObservedCondition(prefix)}`
    : `WHERE ${excludeObservedCondition(prefix)}`;

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

export function logCost(db: Database.Database, input: LogCostInput): CostEntry {
  const id = genId();
  const ts = now();
  return db.prepare(
    `INSERT INTO cost_entries (id, agent_id, task_id, milestone_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
  ).get(
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
  ) as CostEntry;
}

type CostSummaryColumn = "agent_id" | "milestone_id" | "project_id";

function getCostSummaryBy(db: Database.Database, column: CostSummaryColumn, value: string): CostSummary {
  return db.prepare(
    `SELECT ${totalCostSql()},
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS entry_count,
            ${unpricedSql()}
     FROM cost_entries WHERE ${column} = ? AND ${excludeObservedCondition()}`
  ).get(value) as CostSummary;
}

export function getSpendToday(db: Database.Database): number {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM cost_entries
       WHERE created_at >= ? AND ${excludeObservedCondition()}`
    )
    .get(todayStart.toISOString()) as { total: number };
  return row.total;
}

export function getGlobalCostSummary(db: Database.Database): CostSummary {
  return db.prepare(
    `SELECT ${totalCostSql()},
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS entry_count,
            ${unpricedSql()}
     FROM cost_entries ${withExclusion("")}`
  ).get() as CostSummary;
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
  const days = filter.days ?? 30;
  const { sql: where, params } = buildWhere([
    filter.agent_id ? ["agent_id = ?", filter.agent_id] : null,
    filter.milestone_id ? ["milestone_id = ?", filter.milestone_id] : null,
    filter.project_id ? ["project_id = ?", filter.project_id] : null,
    ["created_at >= ?", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()],
  ]);

  const rows = db.prepare(
    `SELECT DATE(created_at) AS date,
            ${totalCostSql()},
            COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
            COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
            COUNT(*) AS entry_count,
            ${unpricedSql()}
     FROM cost_entries
     ${withExclusion(where)}
     GROUP BY DATE(created_at)
     ORDER BY date ASC`
  ).all(...params) as CostTimeseriesEntry[];

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const out: CostTimeseriesEntry[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(todayUtc - i * dayMs).toISOString().slice(0, 10);
    out.push(
      byDate.get(date) ?? {
        date,
        total_cost_usd: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        entry_count: 0,
        unpriced_entries: 0,
      }
    );
  }
  return out;
}

export function getCostByModel(
  db: Database.Database,
  filter: { project_id?: string; milestone_id?: string } = {}
): CostByModelEntry[] {
  const { sql: where, params } = buildWhere([
    filter.project_id ? ["project_id = ?", filter.project_id] : null,
    filter.milestone_id ? ["milestone_id = ?", filter.milestone_id] : null,
  ]);

  return db.prepare(
    `SELECT model, provider,
            ${totalCostSql()},
            COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens,
            COUNT(*) AS entry_count,
            ${unpricedSql()}
     FROM cost_entries
     ${withExclusion(where)}
     GROUP BY model, provider
     ORDER BY total_cost_usd DESC`
  ).all(...params) as CostByModelEntry[];
}

export function getCostByAgent(
  db: Database.Database,
  filter: { project_id?: string; milestone_id?: string } = {}
): CostByAgentEntry[] {
  const conditions: string[] = ["c.agent_id IS NOT NULL", excludeObservedCondition("c.")];
  const params: unknown[] = [];

  if (filter.project_id) { conditions.push("c.project_id = ?"); params.push(filter.project_id); }
  if (filter.milestone_id) { conditions.push("c.milestone_id = ?"); params.push(filter.milestone_id); }

  const where = "WHERE " + conditions.join(" AND ");

  return db.prepare(
    `SELECT c.agent_id, a.name AS agent_name,
            ${totalCostSql("c.")},
            COALESCE(SUM(c.input_tokens + c.output_tokens), 0) AS total_tokens,
            COUNT(*) AS entry_count,
            ${unpricedSql("c.")}
     FROM cost_entries c
     JOIN agents a ON c.agent_id = a.id
     ${where}
     GROUP BY c.agent_id, a.name
     ORDER BY total_cost_usd DESC`
  ).all(...params) as CostByAgentEntry[];
}
