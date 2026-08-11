import type Database from "better-sqlite3";

/**
 * Parse an OTLP nanosecond timestamp string as a BigInt.
 *
 * These values sit around 1.7e18, well past Number.MAX_SAFE_INTEGER, so
 * comparing them by parsing to `number` silently loses precision and can
 * make a genuinely later timestamp compare as equal or earlier. BigInt is
 * exact for this range. Returns null for anything that is not a plain
 * non-negative integer string -- a legacy `otlp_series` row written before
 * this column existed stores `''` (see migration 022), and a point whose
 * ordering cannot be determined must not be treated as a confident "older".
 */
function parseNano(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  return BigInt(raw);
}

/**
 * Whether `timeUnixNano` is strictly newer than `previousTimeUnixNano`.
 *
 * Ambiguous cases (either side unparseable -- a legacy row, or a value that
 * fails to parse as an integer nanosecond timestamp) are treated as newer
 * rather than discarded: under this project's rule, losing real spend from a
 * point wrongly judged "older" is exactly as bad as double-counting one
 * wrongly judged "newer", and there is no third option here.
 */
function isStrictlyNewer(timeUnixNano: string, previousTimeUnixNano: string): boolean {
  const next = parseNano(timeUnixNano);
  const previous = parseNano(previousTimeUnixNano);
  if (next === null || previous === null) return true;
  return next > previous;
}

/**
 * How much of a cumulative metric value is new since the last point.
 *
 * Call this only for cumulative points. A delta point already describes an
 * interval and must be recorded as-is; passing one here would treat successive
 * intervals as a running total and understate everything after the first.
 *
 * Returns the full value for a series we have not seen, and for a restart. A
 * restart is judged ONLY by the value going backwards below what we stored:
 * spend already incurred is never subtracted, so a decrease is read as "the
 * counter went back to zero and has climbed to here again".
 *
 * `start_time_nano` is stored below and kept for diagnostics, but it is
 * DELIBERATELY not consulted in the restart decision above. That used to read
 * `previous?.start_time_nano !== startTimeNano`, and it was wrong: a
 * cumulative sender that re-stamps `startTimeUnixNano` on every export while
 * its counter climbs normally would then have its FULL running total
 * re-recorded on every single export —
 *
 *   export 1: value 1000 -> records 1000        (truth 1000)
 *   export 2: start changes, value 1600 -> records 1600   (truth  600)
 *   export 3: start changes, value 2000 -> records 2000   (truth  400)
 *
 * — 4600 recorded against 2000 of real spend, and it compounds without bound
 * as more exports arrive. Nothing about that fails or looks wrong from the
 * inside: `external_id` idempotency never engages, because `timeUnixNano`
 * differs on every export too.
 *
 * The two candidate errors here are not symmetrical, which is why the fix is
 * to drop start time from the decision rather than to combine it more
 * cleverly with the value check:
 *
 * - Treating a re-stamped continuation as a restart inflates by the previous
 *   value on EVERY export. Unbounded and compounding.
 * - Treating a genuine restart as a continuation understates ONCE, by at most
 *   the old series' last value, and only in the narrow case where the
 *   restarted process's value exceeds the old total before its first export.
 *   A restart normally resumes near zero, which the value-decrease rule below
 *   still catches.
 *
 * Trading an unbounded, compounding overstatement for a bounded, one-off
 * understatement is the correct direction under this project's rule that a
 * silently wrong money figure is the worst defect available, including one
 * wrong by being too low: the one-off understatement is bounded and rare,
 * the compounding overstatement is neither. Do not restore the start-time
 * comparison; it was not an oversight that it was removed.
 *
 * **Out-of-order delivery (Finding 2).** `external_id` idempotency discards a
 * duplicate ROW, but this function still runs before that check, because
 * `buildGroups` (ingest.ts) resolves the increment before the insert that
 * dedupes it. Without a guard here, a late retry of an EARLIER export --
 * value 100 at t=2000, arriving after a legitimate 150 at t=3000 has already
 * been processed -- reads as a restart (100 < 150) and resets `last_value` to
 * 100. The retry's own row is then correctly discarded by `external_id`, but
 * the damage is already done: the next real export (200 at t=4000) computes
 * 200 - 100 = 100 against the corrupted state instead of the true
 * 200 - 150 = 50, permanently inflating the total by 50 through state alone,
 * with no row to point to as the cause.
 *
 * `timeUnixNano` is therefore compared to the series' stored
 * `last_time_unix_nano` (via BigInt -- see `isStrictlyNewer`) BEFORE the
 * value comparison runs at all. A point whose timestamp is not strictly
 * newer carries no new information about the running total by definition
 * and is ignored: it returns 0 and leaves the stored row completely
 * untouched, rather than being folded into the restart/increment logic
 * below. This only applies to cumulative series -- a delta point describes
 * an interval, not a running total, so two delta points may legitimately
 * share or reorder timestamps and must reach the caller unaffected; callers
 * only invoke this function for cumulative points in the first place.
 */
export function seriesIncrement(
  db: Database.Database,
  key: string,
  startTimeNano: string,
  timeUnixNano: string,
  value: number
): number {
  const previous = db
    .prepare("SELECT start_time_nano, last_value, last_time_unix_nano FROM otlp_series WHERE series_key = ?")
    .get(key) as { start_time_nano: string; last_value: number; last_time_unix_nano: string } | undefined;

  if (previous !== undefined && !isStrictlyNewer(timeUnixNano, previous.last_time_unix_nano)) {
    return 0;
  }

  const restarted = previous === undefined || value < previous.last_value;

  const increment = restarted ? value : value - previous.last_value;

  db.prepare(
    `INSERT INTO otlp_series (series_key, start_time_nano, last_value, last_time_unix_nano, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(series_key) DO UPDATE SET
       start_time_nano      = excluded.start_time_nano,
       last_value           = excluded.last_value,
       last_time_unix_nano  = excluded.last_time_unix_nano,
       updated_at           = excluded.updated_at`
  ).run(key, startTimeNano, value, timeUnixNano, new Date().toISOString());

  return increment;
}
