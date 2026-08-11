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
    expect(seriesIncrement(db, KEY, START, 100)).toBe(100);
  });

  it("returns only the increase on subsequent points", () => {
    // The heart of the feature. A cumulative sender re-sends a running total on
    // every export; recording the value rather than the increase multiplies
    // reported spend by the number of exports, silently.
    expect(seriesIncrement(db, KEY, START, 100)).toBe(100);
    expect(seriesIncrement(db, KEY, START, 250)).toBe(150);
    expect(seriesIncrement(db, KEY, START, 260)).toBe(10);
  });

  it("returns zero when the value has not moved", () => {
    seriesIncrement(db, KEY, START, 100);
    expect(seriesIncrement(db, KEY, START, 100)).toBe(0);
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
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, "2000", 520)).toBe(20);
  });

  it("does not compound a normally-climbing series whose start time is re-stamped every export", () => {
    // The exact scenario the old start-time rule got wrong. Truth: 1000, then
    // +600, then +400 = 2000 total spend. Under the old rule each export's
    // start-time change alone triggered a restart, so it would have recorded
    // 1000, then 1600, then 2000 -- 4600 against 2000 of real spend. The fixed
    // rule records only the true increments.
    expect(seriesIncrement(db, KEY, "start-a", 1000)).toBe(1000);
    expect(seriesIncrement(db, KEY, "start-b", 1600)).toBe(600);
    expect(seriesIncrement(db, KEY, "start-c", 2000)).toBe(400);
  });

  it("treats a value going backwards as a restart, not a negative delta", () => {
    // Some senders reuse a start time across a restart. A decrease is the only
    // remaining signal, and spend already incurred must never be subtracted.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, START, 30)).toBe(30);
  });

  it("still detects a restart by value when the start time ALSO changes", () => {
    // Belt and braces: a genuine restart that happens to also re-stamp start
    // time must still be caught by the value-decrease rule alone, since start
    // time is no longer consulted either way.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, "9999", 10)).toBe(10);
  });

  it("keeps series independent", () => {
    seriesIncrement(db, "a", START, 100);
    expect(seriesIncrement(db, "b", START, 7)).toBe(7);
    expect(seriesIncrement(db, "a", START, 130)).toBe(30);
  });

  it("stores the latest value and start time, not the first", () => {
    seriesIncrement(db, KEY, START, 100);
    seriesIncrement(db, KEY, "2000", 40);
    const row = db.prepare("SELECT start_time_nano, last_value FROM otlp_series WHERE series_key = ?").get(KEY) as
      { start_time_nano: string; last_value: number };
    expect(row.start_time_nano).toBe("2000");
    expect(row.last_value).toBe(40);
  });
});
