import type Database from "better-sqlite3";

export interface AgentScore {
  agent_id: string;
  agent_name: string;
  score: number;
  speed_score: number;
  quality_score: number;
  cost_score: number;
  familiarity_score: number;
  task_count: number;
}

export interface AgentSuggestion {
  agent: AgentScore;
  confidence: number;
}

const SPEED_FAST_SECONDS = 3600;
const SPEED_SLOW_SECONDS = 86400;
const COST_EXPENSIVE_USD = 1;
const FAMILIARITY_MAX_TASKS = 10;
const CONFIDENCE_FULL_TASK_COUNT = 5;

interface AgentMetricsRow {
  agent_id: string;
  agent_name: string;
  task_count: number;
  avg_duration: number | null;
  avg_quality: number | null;
}

interface CostRow {
  agent_id: string;
  avg_cost: number | null;
}

interface FamiliarityRow {
  agent_id: string;
  project_task_count: number;
}

export function scoreAgents(db: Database.Database, taskId: string): AgentScore[] {
  const task = db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(taskId) as
    | { project_id: string }
    | undefined;

  if (!task) return [];

  const agentRows = db.prepare(`
    SELECT
      cm.agent_id,
      a.name AS agent_name,
      COUNT(*) AS task_count,
      AVG(cm.duration_seconds) AS avg_duration,
      AVG(
        CASE
          WHEN cm.tests_added > 0 THEN CAST(cm.tests_passing AS REAL) / cm.tests_added
          ELSE NULL
        END
      ) AS avg_quality
    FROM completion_metrics cm
    JOIN agents a ON a.id = cm.agent_id
    GROUP BY cm.agent_id
  `).all() as AgentMetricsRow[];

  if (agentRows.length === 0) return [];

  const agentIds = agentRows.map((r) => r.agent_id);
  if (agentIds.length === 0) return [];
  const placeholders = agentIds.map(() => "?").join(", ");

  const costRows = db.prepare(`
    SELECT agent_id, AVG(cost_usd) AS avg_cost
    FROM cost_entries
    WHERE agent_id IN (${placeholders})
    GROUP BY agent_id
  `).all(...agentIds) as CostRow[];

  const costMap = new Map<string, number>();
  for (const row of costRows) {
    if (row.avg_cost !== null) costMap.set(row.agent_id, row.avg_cost);
  }

  const familiarityRows = db.prepare(`
    SELECT cm.agent_id, COUNT(*) AS project_task_count
    FROM completion_metrics cm
    JOIN tasks t ON t.id = cm.task_id
    WHERE t.project_id = ? AND cm.agent_id IN (${placeholders})
    GROUP BY cm.agent_id
  `).all(task.project_id, ...agentIds) as FamiliarityRow[];

  const familiarityMap = new Map<string, number>();
  for (const row of familiarityRows) {
    familiarityMap.set(row.agent_id, row.project_task_count);
  }

  const scores: AgentScore[] = agentRows.map((row) => {
    const avgDuration = row.avg_duration ?? null;
    const speed_score = avgDuration === null
      ? 50
      : avgDuration <= SPEED_FAST_SECONDS
        ? 100
        : avgDuration >= SPEED_SLOW_SECONDS
          ? 0
          : Math.round((1 - (avgDuration - SPEED_FAST_SECONDS) / (SPEED_SLOW_SECONDS - SPEED_FAST_SECONDS)) * 100);

    const avgQuality = row.avg_quality;
    const quality_score = avgQuality === null ? 50 : Math.round(Math.min(avgQuality, 1) * 100);

    const avgCostRaw = costMap.get(row.agent_id);
    const cost_score = avgCostRaw === undefined
      ? 50
      : avgCostRaw <= 0
        ? 100
        : avgCostRaw >= COST_EXPENSIVE_USD
          ? 0
          : Math.round((1 - avgCostRaw / COST_EXPENSIVE_USD) * 100);

    const projectTaskCount = familiarityMap.get(row.agent_id) ?? 0;
    const familiarity_score = Math.min(Math.round((projectTaskCount / FAMILIARITY_MAX_TASKS) * 100), 100);

    const score = Math.round(
      speed_score * 0.30 +
      quality_score * 0.30 +
      cost_score * 0.20 +
      familiarity_score * 0.20
    );

    return {
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      score,
      speed_score,
      quality_score,
      cost_score,
      familiarity_score,
      task_count: row.task_count,
    };
  });

  return scores.sort((a, b) => b.score - a.score);
}

export function suggestAgent(db: Database.Database, taskId: string): AgentSuggestion | null {
  const scores = scoreAgents(db, taskId);
  if (scores.length === 0) return null;

  const top = scores[0];
  const confidence = Math.min(Math.round((top.task_count / CONFIDENCE_FULL_TASK_COUNT) * 100), 100);

  return { agent: top, confidence };
}
