import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { seriesIncrement, seriesCap } from "../server/ingest/otlp/series.js";
import { ingestMetricsPayload, refusedSeriesPointCount } from "../server/ingest/otlp/ingest.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

/**
 * Fill otlp_series to `rows` entries in one statement.
 *
 * A recursive CTE rather than ten thousand round trips: the point of these
 * tests is the behaviour at the boundary, not how long it takes to reach it.
 */
function fillSeries(db: Database.Database, rows: number): void {
  db.prepare(
    `WITH RECURSIVE counter(x) AS (
       SELECT 1 UNION ALL SELECT x + 1 FROM counter WHERE x < ?
     )
     INSERT INTO otlp_series (series_key, start_time_nano, last_value, last_time_unix_nano, updated_at)
     SELECT 'filler-' || x, '1000', 0, '1000', '2026-08-11T00:00:00.000Z' FROM counter`
  ).run(rows);
}

function seriesCount(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM otlp_series").get() as { n: number }).n;
}

describe("the series cap", () => {
  it("creates a new series while the table is under the cap", () => {
    expect(seriesIncrement(db, "fresh", "1000", "2000", 100)).toBe(100);
  });

  it("refuses a NEW series once the table is full, returning null not zero", () => {
    // null and 0 mean different things and must not be conflated: null is
    // spend we could not record, 0 is a series that has not moved.
    fillSeries(db, seriesCap());
    expect(seriesIncrement(db, "one-too-many", "1000", "2000", 100)).toBeNull();
  });

  it("writes no row when it refuses, so the cap actually holds", () => {
    fillSeries(db, seriesCap());
    seriesIncrement(db, "one-too-many", "1000", "2000", 100);
    expect(seriesCount(db)).toBe(seriesCap());
  });

  it("KEEPS RECORDING an existing series at the cap", () => {
    // The property that makes this design safe rather than merely bounded. An
    // established sender must be unaffected by how full the table is, because
    // the alternative is losing its spend for someone else's flood.
    seriesIncrement(db, "established", "1000", "2000", 100);
    fillSeries(db, seriesCap());

    expect(seriesIncrement(db, "established", "1000", "3000", 150)).toBe(50);
  });

  it("still refuses after the table is over the cap", () => {
    fillSeries(db, seriesCap() + 50);
    expect(seriesIncrement(db, "another", "1000", "2000", 100)).toBeNull();
  });

  it("creates the very last series at exactly one below the cap", () => {
    // Boundary: create when count < seriesCap(), refuse when count >= seriesCap().
    fillSeries(db, seriesCap() - 1);
    expect(seriesIncrement(db, "the-last-one", "1000", "2000", 100)).toBe(100);
    expect(seriesCount(db)).toBe(seriesCap());
  });
});

describe("a refused point through the pipeline", () => {
  function cumulativePayload(key: string, sum: number): unknown {
    return {
      resourceMetrics: [{
        resource: { attributes: [{ key: "nonce", value: { stringValue: key } }] },
        scopeMetrics: [{ scope: { name: "codex" }, metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5.3-codex" } },
              ],
              startTimeUnixNano: "1000", timeUnixNano: "2000", count: "1", sum,
            }],
          },
        }] }],
      }],
    };
  }

  it("writes no cost row and is counted as refused", () => {
    fillSeries(db, seriesCap());
    const before = refusedSeriesPointCount();

    const result = ingestMetricsPayload(db, cumulativePayload("a", 500));

    expect(result.recorded).toBe(0);
    expect(result.refused).toBe(1);
    expect(refusedSeriesPointCount()).toBe(before + 1);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM cost_entries").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("does not count an unmoved existing series as refused", () => {
    // The coercion trap in reverse: a series that has not moved returns 0, not
    // null, and must not inflate the refused count.
    ingestMetricsPayload(db, cumulativePayload("b", 500));
    const before = refusedSeriesPointCount();

    const result = ingestMetricsPayload(db, cumulativePayload("b", 500));

    expect(result.refused).toBe(0);
    expect(refusedSeriesPointCount()).toBe(before);
  });

  it("leaves a DELTA point unaffected at the cap", () => {
    // Delta points never call seriesIncrement, so the cap cannot reach them.
    fillSeries(db, seriesCap());
    const payload = cumulativePayload("c", 500) as {
      resourceMetrics: { scopeMetrics: { metrics: { histogram: { aggregationTemporality: string } }[] }[] }[];
    };
    payload.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.aggregationTemporality =
      "AGGREGATION_TEMPORALITY_DELTA";

    const result = ingestMetricsPayload(db, payload);

    expect(result.recorded).toBe(1);
    expect(result.refused).toBe(0);
  });
});
