/**
 * Tier 1 detectors — ship Hot spots MVP.
 * All use existing tables with no baseline accumulation required.
 *
 * Registration: call registerTier1Detectors() once at server startup.
 */

import { registerDetector } from "./registry.js";
import type { DetectorContext, Match } from "./types.js";

// ─── blocker-aging ────────────────────────────────────────────────────────────
// Open blockers older than 24 h. Score ramps with age: 24 h → 50, 48 h → 75, 72 h+ → 95.

interface BlockerRow {
  id: string;
  task_id: string;
  reason: string;
  reported_at: string;
  task_title: string | null;
}

function blockerAgeHours(blocker: BlockerRow, now: string): number {
  const ms = new Date(now).getTime() - new Date(blocker.reported_at).getTime();
  return ms / 3_600_000;
}

function blockerScore(ageHours: number): number {
  if (ageHours >= 72) return 95;
  if (ageHours >= 48) return 75;
  return 50;
}

// ─── agent-silence ────────────────────────────────────────────────────────────
// Agents with an open in_progress task but no activity in the last 2 hours.
// The "has open task" clause is the key: silences noise from idle agents.

interface AgentRow {
  id: string;
  name: string;
  last_seen_at: string;
  task_id: string;
  task_title: string | null;
}

const AGENT_SILENCE_THRESHOLD_HOURS = 2;

function agentSilenceHours(agent: AgentRow, now: string): number {
  const ms = new Date(now).getTime() - new Date(agent.last_seen_at).getTime();
  return ms / 3_600_000;
}

function agentSilenceScore(silenceHours: number): number {
  // 2 h → 60, 4 h → 80, 8 h+ → 95
  if (silenceHours >= 8) return 95;
  if (silenceHours >= 4) return 80;
  return 60;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerTier1Detectors(): void {
  registerDetector({
    id: "blocker-aging",
    category: "blocker",
    defaultThreshold: 50,

    predicate({ db, now }: DetectorContext): Match[] {
      const rows = db.prepare(`
        SELECT b.id, b.task_id, b.reason, b.reported_at, t.title AS task_title
        FROM blockers b
        LEFT JOIN tasks t ON b.task_id = t.id
        WHERE b.resolved_at IS NULL
      `).all() as BlockerRow[];

      return rows
        .filter((b) => blockerAgeHours(b, now) >= 24)
        .map((b) => ({
          entityId: b.id,
          entityType: "blocker" as const,
          label: b.task_title ? `Blocker on "${b.task_title}"` : "Open blocker",
          detail: b.reason,
        }));
    },

    score(match, { db, now }: DetectorContext): number {
      const row = db.prepare(
        "SELECT id, task_id, reason, reported_at FROM blockers WHERE id = ?"
      ).get(match.entityId) as BlockerRow | undefined;
      if (!row) return 0;
      return blockerScore(blockerAgeHours({ ...row, task_title: null }, now));
    },
  });

  registerDetector({
    id: "agent-silence",
    category: "agent",
    defaultThreshold: 60,

    predicate({ db, now }: DetectorContext): Match[] {
      const cutoff = new Date(
        new Date(now).getTime() - AGENT_SILENCE_THRESHOLD_HOURS * 3_600_000
      ).toISOString();

      // Agents with last_seen_at < cutoff that have at least one in_progress task.
      const rows = db.prepare(`
        SELECT a.id, a.name, a.last_seen_at,
               MIN(t.id)    AS task_id,
               MIN(t.title) AS task_title
        FROM agents a
        JOIN tasks t ON t.assigned_agent_id = a.id AND t.status = 'in_progress'
        WHERE a.last_seen_at < ?
        GROUP BY a.id
      `).all(cutoff) as AgentRow[];

      return rows.map((a) => ({
        entityId: a.id,
        entityType: "agent" as const,
        label: `Agent "${a.name}" silent with open task`,
        detail: a.task_title ?? undefined,
      }));
    },

    score(match, { db, now }: DetectorContext): number {
      const row = db.prepare(
        "SELECT id, name, last_seen_at FROM agents WHERE id = ?"
      ).get(match.entityId) as { id: string; name: string; last_seen_at: string } | undefined;
      if (!row) return 0;
      const hours = agentSilenceHours({ ...row, task_id: "", task_title: null }, now);
      return agentSilenceScore(hours);
    },
  });

}
