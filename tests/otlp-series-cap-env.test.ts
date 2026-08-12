import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { seriesIncrement, seriesCap, DEFAULT_SERIES_CAP } from "../server/ingest/otlp/series.js";

const ENV = "VIBE_DASH_OTLP_SERIES_CAP";

let db: Database.Database;
let original: string | undefined;

beforeEach(() => {
  db = createTestDb();
  original = process.env[ENV];
  delete process.env[ENV];
});

afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

function fill(db: Database.Database, rows: number): void {
  db.prepare(
    `WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < ?)
     INSERT INTO otlp_series (series_key, start_time_nano, last_value, last_time_unix_nano, updated_at)
     SELECT 'filler-' || x, '1000', 0, '1000', '2026-08-12T00:00:00.000Z' FROM c`
  ).run(rows);
}

describe("resolving the series cap", () => {
  it("uses the default when the variable is unset", () => {
    expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
  });

  it("uses the default when the variable is empty or whitespace", () => {
    process.env[ENV] = "";
    expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
    process.env[ENV] = "   ";
    expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
  });

  it("honours a positive integer", () => {
    process.env[ENV] = "25";
    expect(seriesCap()).toBe(25);
  });

  it("falls back rather than accepting a value that would refuse everything", () => {
    // A cap of zero or a negative number would refuse every series on an
    // install whose owner believed they had raised the ceiling. Falling back
    // to the default is the safer reading of a typo.
    for (const bad of ["0", "-1", "-10000"]) {
      process.env[ENV] = bad;
      expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
    }
  });

  it("falls back for anything that is not a whole number", () => {
    for (const bad of ["abc", "12.5", "1e5000", "NaN", "Infinity", "10,000"]) {
      process.env[ENV] = bad;
      expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
    }
  });

  it("falls back past the safe integer range", () => {
    // Beyond MAX_SAFE_INTEGER the comparison against a row count stops being
    // meaningful, the same reasoning the ingest path already applies to token
    // quantities.
    process.env[ENV] = String(Number.MAX_SAFE_INTEGER + 2);
    expect(seriesCap()).toBe(DEFAULT_SERIES_CAP);
  });
});

describe("the resolved cap is the one enforced", () => {
  it("refuses a new series at the configured ceiling, not the default", () => {
    // The point of the whole change: raising the ceiling has to actually let
    // a previously refused sender through, without a rebuild.
    process.env[ENV] = "5";
    fill(db, 5);
    expect(seriesIncrement(db, "blocked", "1000", "2000", 100)).toBeNull();

    process.env[ENV] = "6";
    expect(seriesIncrement(db, "blocked", "1000", "2000", 100)).toBe(100);
  });

  it("still never refuses an established series, whatever the ceiling", () => {
    process.env[ENV] = "2";
    seriesIncrement(db, "established", "1000", "2000", 100);
    fill(db, 50);

    expect(seriesIncrement(db, "established", "1000", "3000", 150)).toBe(50);
  });
});
