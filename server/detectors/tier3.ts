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
}
