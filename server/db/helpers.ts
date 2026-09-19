import { randomUUID } from "node:crypto";
import type { Agent } from "../types.js";

export function now(): string {
  return new Date().toISOString();
}

export function genId(): string {
  return randomUUID();
}

/**
 * A stored timestamp column as a comparable Julian day, or NULL when the text
 * is not a date we can read.
 *
 * A query that asks "is this row inside a window" compares through this, never
 * the raw column. The six windows over tasks.updated_at and
 * cost_entries.created_at all do; the session housekeeping in agents.ts still
 * calls julianday() directly, which is safe there only because those queries
 * treat NULL as stale and carry no index. String order is not date order — see closeStaleSession
 * in agents.ts for what that cost — and julianday() returns NULL for anything
 * it cannot read, so an undatable row fails the comparison and drops out of the
 * window instead of inflating it.
 *
 * Only text that starts YYYY-MM-DD reaches julianday(). That whitelist does two
 * jobs a blacklist of bad values could not.
 *
 * It keeps the clock out. julianday('now') is the current instant, and so are
 * 'subsec' and 'subsecond' (added in SQLite 3.42), case-insensitively; a column
 * holding one of those would land inside every window ending today, which is
 * the original fail-open bug wearing a different mask. It also makes the
 * expression indexable: SQLite classes julianday() as slow-change and refuses
 * it in an index expression the moment a stored value actually reads the clock,
 * raising "non-deterministic use of julianday() in an index" — on the CREATE
 * INDEX if such a row already exists, and on every later INSERT once the index
 * is in place. Migration 024 indexes this exact expression over
 * cost_entries.created_at, which is unvalidated text copied from a transcript,
 * so an unguarded expression would let one row make that migration, and
 * therefore opening the database at all, fail permanently.
 *
 * And it cannot be outrun. Enumerating the clock-reading words has already
 * failed once ('subsec' arrived after 'now'), and an exact comparison misses
 * variants regardless: lower('now' with a trailing NUL byte) is not 'now', but
 * julianday() reads the C string and returns the clock anyway.
 *
 * What the whitelist additionally excludes is time-only text ('05:00') and bare
 * Julian day numbers ('2451545'), both of which julianday() reads as a moment
 * on 2000-01-01. Both already sat below every window these queries ask about,
 * so nothing observable changes, and neither is a shape any writer here
 * produces: server/CLAUDE.md requires ISO 8601.
 *
 * The column's own text is what reaches julianday(), never a transformed copy.
 * `julianday(NULLIF(lower(col), 'now'))` silently breaks every real timestamp,
 * because lower() folds the 'T' and 'Z' of an ISO-8601 string and julianday()
 * will not read 'zt' in place of 'ZT' — the whole window empties out. A guard
 * may decide the comparison, not supply the value.
 */
export const julianDaySql = (column: string): string =>
  `julianday(CASE WHEN ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN ${column} END)`;

export function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function parseAgent(row: Record<string, unknown>): Agent {
  return {
    ...(row as Omit<Agent, "capabilities" | "role">),
    capabilities: JSON.parse(row.capabilities as string) as string[],
    role: (row.role as Agent["role"]) ?? "agent",
    parent_agent_id: (row.parent_agent_id as string) ?? null,
    client_name: (row.client_name as string) ?? null,
    // Derived by costObservedSql(). Coerced rather than trusted so a read query
    // that omitted the fragment produces a definite 0 instead of undefined
    // leaking into the API response as a missing field.
    cost_observed_externally: Number(row.cost_observed_externally ?? 0),
  };
}
