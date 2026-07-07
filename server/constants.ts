// Central constants for server-side limits, thresholds, and defaults.
// Keep this file dependency-free — it's imported by db/, routes/, and mcp/.

// ─── Pagination / Query Limits ──────────────────────────────────────────────

export const DEFAULT_TASK_LIST_LIMIT = 200;
export const MAX_TASK_LIST_LIMIT = 500;
export const DEFAULT_NOTIFICATION_LIMIT = 50;
export const MAX_NOTIFICATION_LIMIT = 500;
export const DEFAULT_ACTIVITY_LIMIT = 100;
export const MAX_ACTIVITY_LIMIT = 500;

/**
 * Clamp a caller-supplied list limit into [1, max]. Absent, non-numeric,
 * non-finite, or non-positive input falls back to `fallback` (itself capped to
 * `max`). Keeps caller-controlled `?limit` query params from returning an
 * unbounded number of rows.
 */
export function clampLimit(raw: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max);
  return Math.min(n, max);
}

// ─── Agent Health Thresholds ────────────────────────────────────────────────

export const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
export const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
export const ACTIVE_THRESHOLD_MINUTES = ACTIVE_THRESHOLD_MS / 60_000;

// ─── Session ────────────────────────────────────────────────────────────────

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
