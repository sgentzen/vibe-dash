import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { seriesIncrement } from "../server/ingest/otlp/series.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const KEY = "series-a";
const START = "1000";

describe("seriesIncrement", () => {
  it("returns the whole value the first time a series is seen", () => {
    expect(seriesIncrement(db, KEY, START, "2000", 100)).toBe(100);
  });

  it("returns only the increase on subsequent points", () => {
    // The heart of the feature. A cumulative sender re-sends a running total on
    // every export; recording the value rather than the increase multiplies
    // reported spend by the number of exports, silently.
    expect(seriesIncrement(db, KEY, START, "1000", 100)).toBe(100);
    expect(seriesIncrement(db, KEY, START, "2000", 250)).toBe(150);
    expect(seriesIncrement(db, KEY, START, "3000", 260)).toBe(10);
  });

  it("returns zero when the value has not moved", () => {
    seriesIncrement(db, KEY, START, "1000", 100);
    expect(seriesIncrement(db, KEY, START, "2000", 100)).toBe(0);
  });

  it("does NOT treat a new start time alone as a restart, and continues the total", () => {
    // CHANGED from the original behaviour this test used to pin ("treats a new
    // start time as a restart and takes the full value"). That rule was wrong:
    // a sender that re-stamps startTimeUnixNano on every export while its
    // counter climbs normally would have its FULL running total re-recorded on
    // every export, compounding without bound. A restart is now judged purely
    // by the value going backwards; start_time_nano is still stored (see the
    // row below) but is no longer part of the restart decision. Full reasoning
    // is on seriesIncrement's doc comment in series.ts.
    seriesIncrement(db, KEY, START, "1000", 500);
    expect(seriesIncrement(db, KEY, "2000", "2000", 520)).toBe(20);
  });

  it("does not compound a normally-climbing series whose start time is re-stamped every export", () => {
    // The exact scenario the old start-time rule got wrong. Truth: 1000, then
    // +600, then +400 = 2000 total spend. Under the old rule each export's
    // start-time change alone triggered a restart, so it would have recorded
    // 1000, then 1600, then 2000 -- 4600 against 2000 of real spend. The fixed
    // rule records only the true increments.
    expect(seriesIncrement(db, KEY, "start-a", "1000", 1000)).toBe(1000);
    expect(seriesIncrement(db, KEY, "start-b", "2000", 1600)).toBe(600);
    expect(seriesIncrement(db, KEY, "start-c", "3000", 2000)).toBe(400);
  });

  it("treats a value going backwards as a restart, not a negative delta", () => {
    // Some senders reuse a start time across a restart. A decrease is the only
    // remaining signal, and spend already incurred must never be subtracted.
    seriesIncrement(db, KEY, START, "1000", 500);
    expect(seriesIncrement(db, KEY, START, "2000", 30)).toBe(30);
  });

  it("still detects a restart by value when the start time ALSO changes", () => {
    // Belt and braces: a genuine restart that happens to also re-stamp start
    // time must still be caught by the value-decrease rule alone, since start
    // time is no longer consulted either way.
    seriesIncrement(db, KEY, START, "1000", 500);
    expect(seriesIncrement(db, KEY, "9999", "2000", 10)).toBe(10);
  });

  it("keeps series independent", () => {
    seriesIncrement(db, "a", START, "1000", 100);
    expect(seriesIncrement(db, "b", START, "1000", 7)).toBe(7);
    expect(seriesIncrement(db, "a", START, "2000", 130)).toBe(30);
  });

  it("stores the latest value and start time, not the first", () => {
    seriesIncrement(db, KEY, START, "1000", 100);
    seriesIncrement(db, KEY, "2000", "2000", 40);
    const row = db.prepare("SELECT start_time_nano, last_value FROM otlp_series WHERE series_key = ?").get(KEY) as
      { start_time_nano: string; last_value: number };
    expect(row.start_time_nano).toBe("2000");
    expect(row.last_value).toBe(40);
  });

  // --- Finding 2: out-of-order delivery must not corrupt series state.

  it("ignores a point whose timeUnixNano is not strictly greater, and leaves stored state untouched", () => {
    // Finding 2's exact reproduction. A cumulative sender exports 100 at
    // t=2000, then 150 at t=3000. A late retry of the FIRST export then
    // arrives (value 100, t=2000) -- e.g. a network retry that took a while to
    // land. Under the old rule this read as a restart (100 < 150) and reset
    // last_value to 100, so the NEXT legitimate export computed its increment
    // against the wrong baseline: 200 - 100 = 100 instead of 200 - 150 = 50.
    // The retry's own row would then be discarded by external_id, leaving no
    // row to explain a total that is nonetheless inflated by 50 -- permanent
    // corruption through state alone.
    expect(seriesIncrement(db, KEY, START, "2000", 100)).toBe(100);
    expect(seriesIncrement(db, KEY, START, "3000", 150)).toBe(50);

    // The late retry: same timestamp as the first export, arriving after the
    // second has already been processed. Must contribute nothing and must not
    // touch the stored row.
    expect(seriesIncrement(db, KEY, START, "2000", 100)).toBe(0);

    // The next legitimate export must compute its increment against 150 (the
    // true last value), not against 100 (what the retry would have reset it
    // to under the timestamp-blind rule).
    expect(seriesIncrement(db, KEY, START, "4000", 200)).toBe(50);

    const row = db.prepare(
      "SELECT last_value, last_time_unix_nano FROM otlp_series WHERE series_key = ?"
    ).get(KEY) as { last_value: number; last_time_unix_nano: string };
    expect(row.last_value).toBe(200);
    expect(row.last_time_unix_nano).toBe("4000");
  });

  it("ignores a point whose timeUnixNano exactly ties the stored one", () => {
    // Not just strictly older -- a tie carries no new information either, by
    // the same "strictly greater" rule.
    seriesIncrement(db, KEY, START, "2000", 100);
    expect(seriesIncrement(db, KEY, START, "2000", 999)).toBe(0);
    const row = db.prepare("SELECT last_value FROM otlp_series WHERE series_key = ?").get(KEY) as
      { last_value: number };
    expect(row.last_value).toBe(100);
  });

  it("accepts a point when order cannot be judged (legacy row with no stored timestamp)", () => {
    // A row written before this column existed reads back as '' (the ALTER
    // TABLE default in migration 022). Order cannot be determined from that,
    // and refusing the point would silently lose real spend -- exactly as bad
    // as double-counting under this project's rule -- so it is accepted.
    db.prepare(
      `INSERT INTO otlp_series (series_key, start_time_nano, last_value, updated_at)
       VALUES (?, ?, ?, ?)`
    ).run(KEY, START, 100, new Date().toISOString());

    expect(seriesIncrement(db, KEY, START, "2000", 150)).toBe(50);
  });
});
