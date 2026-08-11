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

  it("treats a new start time as a restart and takes the full value", () => {
    // A process restart begins a new series at zero. Subtracting against the
    // old high-water mark would report negative spend.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, "2000", 20)).toBe(20);
  });

  it("treats a value going backwards as a restart, not a negative delta", () => {
    // Some senders reuse a start time across a restart. A decrease is the only
    // remaining signal, and spend already incurred must never be subtracted.
    seriesIncrement(db, KEY, START, 500);
    expect(seriesIncrement(db, KEY, START, 30)).toBe(30);
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
