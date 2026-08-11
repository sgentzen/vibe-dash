import type Database from "better-sqlite3";

/**
 * How much of a cumulative metric value is new since the last point.
 *
 * Call this only for cumulative points. A delta point already describes an
 * interval and must be recorded as-is; passing one here would treat successive
 * intervals as a running total and understate everything after the first.
 *
 * Returns the full value for a series we have not seen, and for a restart. A
 * restart is a new start time, or a value below the one we stored: spend
 * already incurred is never subtracted, so a decrease is read as "the counter
 * went back to zero and has climbed to here again".
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

  const restarted =
    previous?.start_time_nano !== startTimeNano ||
    (previous !== undefined && value < previous.last_value);

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
