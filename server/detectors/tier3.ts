/**
 * Tier 3 detectors — commit linkage signals.
 *
 * Registration: call registerTier3Detectors() once at server startup.
 */

import { registerDetector } from "./registry.js";
import type { DetectorContext, Match } from "./types.js";

// ─── unlinked-commit ──────────────────────────────────────────────────────────
// Commits in the last 7 days that have no linked task.
// Score is fixed at 60 — a useful heads-up but not urgent.

interface CommitMatchRow {
  sha: string;
  subject: string;
  author_email: string | null;
}

function unlinkedCommitPredicate({ db, now }: DetectorContext): Match[] {
  const since = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT sha, subject, author_email
     FROM commits
     WHERE linked_task_id IS NULL AND authored_at >= ?`
  ).all(since) as CommitMatchRow[];
  return rows.map((r) => ({
    entityId: r.sha,
    entityType: "commit" as const,
    label: "Unlinked commit",
    detail: r.author_email ? `${r.subject} · ${r.author_email}` : r.subject,
  }));
}

// ─── scope-change ─────────────────────────────────────────────────────────────

interface HistoryMatchRow {
  id: string;
  milestone_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  milestone_name: string | null;
}

function truncate(s: string | null, n: number): string {
  if (s === null) return "∅";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function scopeChangePredicate({ db, now }: DetectorContext): Match[] {
  const since = new Date(new Date(now).getTime() - 30 * 86_400_000).toISOString();
  const rows = db.prepare(
    `SELECT h.id, h.milestone_id, h.field, h.old_value, h.new_value, m.name AS milestone_name
     FROM milestone_history h
     LEFT JOIN milestones m ON h.milestone_id = m.id
     WHERE h.changed_at >= ?`
  ).all(since) as HistoryMatchRow[];

  return rows.map((r) => ({
    entityId: r.id,
    entityType: "milestone" as const,
    label: `Milestone ${r.milestone_name ?? "?"} ${r.field} changed`,
    detail: `${truncate(r.old_value, 80)} → ${truncate(r.new_value, 80)}`,
  }));
}

function scopeChangeScore(match: Match, { db }: DetectorContext): number {
  const row = db.prepare("SELECT field FROM milestone_history WHERE id = ?").get(match.entityId) as { field: string } | undefined;
  if (!row) return 0;
  switch (row.field) {
    case "name": return 90;
    case "target_date": return 80;
    case "description":
    case "acceptance_criteria": return 60;
    default: return 50;
  }
}

// ─── activity-burst ───────────────────────────────────────────────────────────

const BURST_WINDOW_MIN = Number(process.env.DETECTOR_BURST_WINDOW_MIN ?? 60);
const BURST_THRESHOLD = Number(process.env.DETECTOR_BURST_THRESHOLD ?? 3.0);
const BURST_MIN_COUNT = 5;
const BURST_BASELINE_DAYS = 7;

interface BurstRow {
  project_id: string;
  project_name: string | null;
  current_count: number;
  baseline_count: number;
}

function activityBurstPredicate({ db, now }: DetectorContext): Match[] {
  const nowMs = new Date(now).getTime();
  const currentSince = new Date(nowMs - BURST_WINDOW_MIN * 60_000).toISOString();
  const baselineSince = new Date(nowMs - BURST_BASELINE_DAYS * 86_400_000).toISOString();

  const rows = db.prepare(
    `SELECT t.project_id AS project_id,
            p.name AS project_name,
            SUM(CASE WHEN a.timestamp >= ? THEN 1 ELSE 0 END) AS current_count,
            SUM(CASE WHEN a.timestamp >= ? AND a.timestamp < ? THEN 1 ELSE 0 END) AS baseline_count
     FROM activity_log a
     JOIN tasks t ON a.task_id = t.id
     LEFT JOIN projects p ON t.project_id = p.id
     WHERE a.timestamp >= ?
     GROUP BY t.project_id`
  ).all(currentSince, baselineSince, currentSince, baselineSince) as BurstRow[];

  return rows
    .filter((r) => {
      if (r.current_count < BURST_MIN_COUNT) return false;
      const slots = (BURST_BASELINE_DAYS * 1440) / BURST_WINDOW_MIN;
      const baselinePerSlot = r.baseline_count / slots;
      const denom = baselinePerSlot < 1 ? 1 : baselinePerSlot;
      const ratio = r.current_count / denom;
      return ratio >= BURST_THRESHOLD;
    })
    .map((r) => ({
      entityId: r.project_id,
      entityType: "area" as const,
      label: `Activity burst in ${r.project_name ?? r.project_id}`,
      detail: `${r.current_count} events in ${BURST_WINDOW_MIN}m, baseline ${r.baseline_count} over ${BURST_BASELINE_DAYS}d`,
    }));
}

function activityBurstScore(match: Match, { db, now }: DetectorContext): number {
  const nowMs = new Date(now).getTime();
  const currentSince = new Date(nowMs - BURST_WINDOW_MIN * 60_000).toISOString();
  const baselineSince = new Date(nowMs - BURST_BASELINE_DAYS * 86_400_000).toISOString();
  const row = db.prepare(
    `SELECT SUM(CASE WHEN a.timestamp >= ? THEN 1 ELSE 0 END) AS cur,
            SUM(CASE WHEN a.timestamp >= ? AND a.timestamp < ? THEN 1 ELSE 0 END) AS base
     FROM activity_log a JOIN tasks t ON a.task_id = t.id
     WHERE t.project_id = ? AND a.timestamp >= ?`
  ).get(currentSince, baselineSince, currentSince, match.entityId, baselineSince) as { cur: number; base: number };
  const slots = (BURST_BASELINE_DAYS * 1440) / BURST_WINDOW_MIN;
  const perSlot = row.base / slots;
  const denom = perSlot < 1 ? 1 : perSlot;
  const ratio = row.cur / denom;
  if (ratio >= 10) return 95;
  if (ratio >= 5) return 80;
  return 65;
}

export function registerTier3Detectors(): void {
  registerDetector({
    id: "unlinked-commit",
    category: "change",
    defaultThreshold: 50,
    predicate: unlinkedCommitPredicate,
    score: () => 60,
  });
  registerDetector({
    id: "scope-change",
    category: "change",
    defaultThreshold: 50,
    predicate: scopeChangePredicate,
    score: scopeChangeScore,
  });
  registerDetector({
    id: "activity-burst",
    category: "change",
    defaultThreshold: 60,
    predicate: activityBurstPredicate,
    score: activityBurstScore,
  });
}
