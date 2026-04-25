/**
 * server/intelligence.ts
 *
 * AI-powered natural-language query and digest generation.
 * Uses @anthropic-ai/sdk with model claude-haiku-4-5-20251001.
 * Requires ANTHROPIC_API_KEY env var — throws if not set.
 */

import Anthropic from "@anthropic-ai/sdk";
import type Database from "better-sqlite3";

export const MODEL = "claude-haiku-4-5-20251001";

// ── Public API ────────────────────────────────────────────────────────────────

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function generateDigest(
  db: Database.Database,
  period: "daily" | "weekly",
  projectId?: string
): Promise<string> {
  requireApiKey();

  const ctx = buildDigestContext(db, period, projectId);
  const systemPrompt = buildDigestSystemPrompt();
  const userMessage = `Generate a ${period} digest summary for the following project data:\n\n${JSON.stringify(ctx, null, 2)}`;

  return callAnthropic(systemPrompt, userMessage);
}

export async function queryNaturalLanguage(
  db: Database.Database,
  question: string,
  projectId?: string
): Promise<string> {
  requireApiKey();

  const ctx = buildQueryContext(db, projectId);
  const systemPrompt = buildQuerySystemPrompt();
  const userMessage = `Project context:\n${JSON.stringify(ctx, null, 2)}\n\nQuestion: ${question}`;

  return callAnthropic(systemPrompt, userMessage);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function requireApiKey(): void {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
}

/**
 * Shared Anthropic API call helper.
 * The cast on `client.messages.create` is required because the SDK typings for
 * this version do not include the `betas` field in the request body type, even
 * though the runtime API accepts it for prompt-caching support.
 */
async function callAnthropic(systemPrompt: string, userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await (client.messages.create as (body: unknown) => Promise<Anthropic.Message>)({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
    betas: ["prompt-caching-2024-07-31"],
  });
  return extractText(response);
}

function extractText(response: Anthropic.Message): string {
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return "";
  return block.text;
}

/** Trim an array to at most maxItems elements to stay within context budget */
function trimArray<T>(arr: T[], maxItems: number): T[] {
  return arr.slice(0, maxItems);
}

// ── Digest context ─────────────────────────────────────────────────────────────

interface DigestContext {
  period: "daily" | "weekly";
  projectName?: string;
  projects: Array<{ name: string; id: string }>;
  recentActivity: Array<{ message: string; timestamp: string; task_title?: string }>;
  taskSummary: { planned: number; in_progress: number; blocked: number; done: number };
  completedTasks: Array<{ title: string; updated_at: string }>;
  activeBlockers: Array<{ reason: string; task_title: string }>;
  topCostsByModel: Array<{ model: string; total_cost: number; total_tokens: number }>;
  activeAgents: Array<{ name: string; last_seen_at: string }>;
}

function buildDigestContext(
  db: Database.Database,
  period: "daily" | "weekly",
  projectId?: string
): DigestContext {
  const hours = period === "daily" ? 24 : 168;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  // Projects
  const projectRows = db
    .prepare("SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 20")
    .all() as Array<{ id: string; name: string }>;

  let projectName: string | undefined;
  if (projectId) {
    projectName = projectRows.find((p) => p.id === projectId)?.name;
  }

  // Recent activity
  // Note: use (t.project_id = ? OR al.task_id IS NULL) to preserve LEFT JOIN semantics —
  // activity entries with no task_id are not excluded by the project filter.
  const activityQuery = projectId
    ? `SELECT al.message, al.timestamp, t.title AS task_title
       FROM activity_log al
       LEFT JOIN tasks t ON al.task_id = t.id
       WHERE al.timestamp >= ? AND (t.project_id = ? OR al.task_id IS NULL)
       ORDER BY al.timestamp DESC LIMIT 50`
    : `SELECT al.message, al.timestamp, t.title AS task_title
       FROM activity_log al
       LEFT JOIN tasks t ON al.task_id = t.id
       WHERE al.timestamp >= ?
       ORDER BY al.timestamp DESC LIMIT 50`;

  const activityRows = (
    projectId
      ? db.prepare(activityQuery).all(since, projectId)
      : db.prepare(activityQuery).all(since)
  ) as Array<{ message: string; timestamp: string; task_title: string | null }>;

  // Task summary
  const taskWhere = projectId ? "WHERE project_id = ?" : "";
  const taskSummaryRows = (
    projectId
      ? db
          .prepare(`SELECT status, COUNT(*) AS cnt FROM tasks ${taskWhere} GROUP BY status`)
          .all(projectId)
      : db.prepare(`SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status`).all()
  ) as Array<{ status: string; cnt: number }>;

  const taskSummary = { planned: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const row of taskSummaryRows) {
    if (row.status === "planned") taskSummary.planned = row.cnt;
    else if (row.status === "in_progress") taskSummary.in_progress = row.cnt;
    else if (row.status === "blocked") taskSummary.blocked = row.cnt;
    else if (row.status === "done") taskSummary.done = row.cnt;
  }

  // Completed tasks in period
  const completedQuery = projectId
    ? `SELECT title, updated_at FROM tasks WHERE status = 'done' AND updated_at >= ? AND project_id = ? ORDER BY updated_at DESC LIMIT 20`
    : `SELECT title, updated_at FROM tasks WHERE status = 'done' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 20`;

  const completedRows = (
    projectId
      ? db.prepare(completedQuery).all(since, projectId)
      : db.prepare(completedQuery).all(since)
  ) as Array<{ title: string; updated_at: string }>;

  // Active blockers
  const blockerQuery = projectId
    ? `SELECT b.reason, t.title AS task_title FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE b.resolved_at IS NULL AND t.project_id = ? LIMIT 20`
    : `SELECT b.reason, t.title AS task_title FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE b.resolved_at IS NULL LIMIT 20`;

  const blockerRows = (
    projectId
      ? db.prepare(blockerQuery).all(projectId)
      : db.prepare(blockerQuery).all()
  ) as Array<{ reason: string; task_title: string }>;

  // Top costs by model
  const costQuery = projectId
    ? `SELECT model, SUM(cost_usd) AS total_cost, SUM(input_tokens + output_tokens) AS total_tokens FROM cost_entries WHERE project_id = ? GROUP BY model ORDER BY total_cost DESC LIMIT 10`
    : `SELECT model, SUM(cost_usd) AS total_cost, SUM(input_tokens + output_tokens) AS total_tokens FROM cost_entries GROUP BY model ORDER BY total_cost DESC LIMIT 10`;

  const costRows = (
    projectId
      ? db.prepare(costQuery).all(projectId)
      : db.prepare(costQuery).all()
  ) as Array<{ model: string; total_cost: number; total_tokens: number }>;

  // Active agents (last 30 min)
  const agentSince = new Date(Date.now() - 30 * 60_000).toISOString();
  const agentRows = db
    .prepare("SELECT name, last_seen_at FROM agents WHERE last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 20")
    .all(agentSince) as Array<{ name: string; last_seen_at: string }>;

  return {
    period,
    projectName,
    projects: trimArray(projectRows, 20),
    recentActivity: trimArray(
      activityRows.map((r) => ({
        message: r.message,
        timestamp: r.timestamp,
        task_title: r.task_title ?? undefined,
      })),
      30
    ),
    taskSummary,
    completedTasks: trimArray(completedRows, 20),
    activeBlockers: trimArray(blockerRows, 20),
    topCostsByModel: trimArray(costRows, 10),
    activeAgents: trimArray(agentRows, 20),
  };
}

// ── Query context ─────────────────────────────────────────────────────────────

interface QueryContext {
  projects: Array<{ id: string; name: string; description: string | null }>;
  tasksByStatus: { planned: number; in_progress: number; blocked: number; done: number };
  recentActivity: Array<{ message: string; timestamp: string; agent_name: string | null; task_title: string | null }>;
  activeBlockers: Array<{ reason: string; task_title: string; reported_at: string }>;
  topCostsByModel: Array<{ model: string; total_cost: number; total_tokens: number }>;
  topCostsByAgent: Array<{ agent_name: string; total_cost: number }>;
  activeAgents: Array<{ name: string; model: string | null; last_seen_at: string }>;
  recentTasks: Array<{ title: string; status: string; priority: string; project_name: string }>;
}

function buildQueryContext(db: Database.Database, projectId?: string): QueryContext {
  const projects = db
    .prepare("SELECT id, name, description FROM projects ORDER BY created_at DESC LIMIT 20")
    .all() as Array<{ id: string; name: string; description: string | null }>;

  const taskSummaryRows = (
    projectId
      ? db.prepare("SELECT status, COUNT(*) AS cnt FROM tasks WHERE project_id = ? GROUP BY status").all(projectId)
      : db.prepare("SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status").all()
  ) as Array<{ status: string; cnt: number }>;

  const tasksByStatus = { planned: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const row of taskSummaryRows) {
    if (row.status === "planned") tasksByStatus.planned = row.cnt;
    else if (row.status === "in_progress") tasksByStatus.in_progress = row.cnt;
    else if (row.status === "blocked") tasksByStatus.blocked = row.cnt;
    else if (row.status === "done") tasksByStatus.done = row.cnt;
  }

  // Recent activity (last 7 days)
  // When projectId is set, filter to that project but preserve rows with no task via LEFT JOIN semantics.
  const since7d = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const activityQuery7d = projectId
    ? `SELECT al.message, al.timestamp, ag.name AS agent_name, t.title AS task_title
       FROM activity_log al
       LEFT JOIN agents ag ON al.agent_id = ag.id
       LEFT JOIN tasks t ON al.task_id = t.id
       WHERE al.timestamp >= ? AND (t.project_id = ? OR al.task_id IS NULL)
       ORDER BY al.timestamp DESC LIMIT 40`
    : `SELECT al.message, al.timestamp, ag.name AS agent_name, t.title AS task_title
       FROM activity_log al
       LEFT JOIN agents ag ON al.agent_id = ag.id
       LEFT JOIN tasks t ON al.task_id = t.id
       WHERE al.timestamp >= ?
       ORDER BY al.timestamp DESC LIMIT 40`;

  const activityRows = (
    projectId
      ? db.prepare(activityQuery7d).all(since7d, projectId)
      : db.prepare(activityQuery7d).all(since7d)
  ) as Array<{ message: string; timestamp: string; agent_name: string | null; task_title: string | null }>;

  // Active blockers
  const blockerQuery = projectId
    ? `SELECT b.reason, t.title AS task_title, b.reported_at FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE b.resolved_at IS NULL AND t.project_id = ? LIMIT 20`
    : `SELECT b.reason, t.title AS task_title, b.reported_at FROM blockers b JOIN tasks t ON b.task_id = t.id WHERE b.resolved_at IS NULL LIMIT 20`;

  const blockerRows = (
    projectId ? db.prepare(blockerQuery).all(projectId) : db.prepare(blockerQuery).all()
  ) as Array<{ reason: string; task_title: string; reported_at: string }>;

  // Top costs by model
  const costByModelRows = db
    .prepare(
      `SELECT model, SUM(cost_usd) AS total_cost, SUM(input_tokens + output_tokens) AS total_tokens
       FROM cost_entries GROUP BY model ORDER BY total_cost DESC LIMIT 10`
    )
    .all() as Array<{ model: string; total_cost: number; total_tokens: number }>;

  // Top costs by agent
  const costByAgentRows = db
    .prepare(
      `SELECT ag.name AS agent_name, SUM(ce.cost_usd) AS total_cost
       FROM cost_entries ce JOIN agents ag ON ce.agent_id = ag.id
       GROUP BY ag.id ORDER BY total_cost DESC LIMIT 10`
    )
    .all() as Array<{ agent_name: string; total_cost: number }>;

  // Active agents (last 2 hours)
  const agentSince = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const agentRows = db
    .prepare(
      "SELECT name, model, last_seen_at FROM agents WHERE last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 20"
    )
    .all(agentSince) as Array<{ name: string; model: string | null; last_seen_at: string }>;

  // Recent tasks
  const recentTaskQuery = projectId
    ? `SELECT t.title, t.status, t.priority, p.name AS project_name FROM tasks t JOIN projects p ON t.project_id = p.id WHERE t.project_id = ? ORDER BY t.updated_at DESC LIMIT 30`
    : `SELECT t.title, t.status, t.priority, p.name AS project_name FROM tasks t JOIN projects p ON t.project_id = p.id ORDER BY t.updated_at DESC LIMIT 30`;

  const recentTaskRows = (
    projectId
      ? db.prepare(recentTaskQuery).all(projectId)
      : db.prepare(recentTaskQuery).all()
  ) as Array<{ title: string; status: string; priority: string; project_name: string }>;

  return {
    projects: trimArray(projects, 20),
    tasksByStatus,
    recentActivity: trimArray(activityRows, 30),
    activeBlockers: trimArray(blockerRows, 20),
    topCostsByModel: trimArray(costByModelRows, 10),
    topCostsByAgent: trimArray(costByAgentRows, 10),
    activeAgents: trimArray(agentRows, 20),
    recentTasks: trimArray(recentTaskRows, 25),
  };
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildDigestSystemPrompt(): string {
  return `You are an AI assistant that generates concise, human-readable project status digests for software development teams using an AI-agent monitoring dashboard called vibe-dash.

When given project data in JSON format, write a clear markdown summary covering:
- What was accomplished (completed tasks)
- Current state (active work, blocked items)
- Cost and usage highlights if noteworthy
- Active agents and their contributions

Keep the digest concise (under 400 words). Use markdown headings and bullet lists. Be direct and factual — avoid padding.`;
}

function buildQuerySystemPrompt(): string {
  return `You are an AI assistant embedded in vibe-dash, a local-first AI agent monitoring dashboard. You answer natural-language questions about project data including tasks, agents, costs, blockers, and activity logs.

When given project context in JSON format and a user question, answer concisely and accurately based only on the provided data. If the data doesn't contain enough information to answer definitively, say so clearly.

Use markdown formatting for lists and structure. Keep answers under 300 words unless a detailed breakdown is requested.`;
}
