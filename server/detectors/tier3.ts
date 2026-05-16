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

export function registerTier3Detectors(): void {
  registerDetector({
    id: "unlinked-commit",
    category: "change",
    defaultThreshold: 50,
    predicate: unlinkedCommitPredicate,
    score: () => 60,
  });
}
