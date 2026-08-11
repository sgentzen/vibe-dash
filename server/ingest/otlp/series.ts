import type Database from "better-sqlite3";

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
 */
export function seriesIncrement(
  db: Database.Database,
  key: string,
  startTimeNano: string,
  value: number
): number {
  const previous = db
    .prepare("SELECT start_time_nano, last_value FROM otlp_series WHERE series_key = ?")
    .get(key) as { start_time_nano: string; last_value: number } | undefined;

  const restarted = previous === undefined || value < previous.last_value;

  const increment = restarted ? value : value - previous.last_value;

  db.prepare(
    `INSERT INTO otlp_series (series_key, start_time_nano, last_value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(series_key) DO UPDATE SET
       start_time_nano = excluded.start_time_nano,
       last_value      = excluded.last_value,
       updated_at      = excluded.updated_at`
  ).run(key, startTimeNano, value, new Date().toISOString());

  return increment;
}
