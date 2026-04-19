// Central constants for server-side limits, thresholds, and defaults.
// Keep this file dependency-free — it's imported by db/, routes/, and mcp/.

// ─── Pagination / Query Limits ──────────────────────────────────────────────

export const DEFAULT_TASK_LIST_LIMIT = 200;
export const MAX_TASK_LIST_LIMIT = 500;
export const BULK_UPDATE_MAX = 200;
export const DEFAULT_NOTIFICATION_LIMIT = 50;
export const DEFAULT_ACTIVITY_LIMIT = 100;

// ─── Agent Health Thresholds ────────────────────────────────────────────────

export const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
export const IDLE_THRESHOLD_MS = 30 * 60 * 1000;
export const ACTIVE_THRESHOLD_MINUTES = ACTIVE_THRESHOLD_MS / 60_000;

// ─── Session ────────────────────────────────────────────────────────────────

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
