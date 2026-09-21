import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import { createTestDb } from "./setup.js";
import { requestApp } from "./http-helper.js";
import { createRouter } from "../server/routes/index.js";
import { errorHandler } from "../server/routes/middleware.js";
import { getCostTimeseries } from "../server/db/index.js";
import { MAX_COST_DAYS } from "../server/constants.js";

let app: Express;
let db: ReturnType<typeof createTestDb>;

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(createRouter(db));
  app.use(errorHandler);
});

/**
 * getCostTimeseries stitches one object per requested day, in a synchronous
 * loop, so an unclamped `days` is a heap-exhaustion lever on an unauthenticated
 * endpoint: better-sqlite3 and the loop both block the event loop, taking the
 * WebSocket broadcast and every other route down with it. The values below are
 * far smaller than a real attack (10^8) so a regression fails on an assertion
 * rather than by killing the test worker.
 */
describe("GET /api/costs?groupBy=day clamps days", () => {
  function series(days: string) {
    return requestApp(app, "GET", `/api/costs?groupBy=day&days=${days}`);
  }

  it("caps an oversized days at the maximum", async () => {
    const res = await series("1000000");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(MAX_COST_DAYS);
  });

  it("allows the maximum itself", async () => {
    const res = await series(String(MAX_COST_DAYS));

    expect(res.body).toHaveLength(MAX_COST_DAYS);
  });

  it("raises zero and negative days to one", async () => {
    expect((await series("0")).body).toHaveLength(1);
    expect((await series("-5")).body).toHaveLength(1);
  });

  it("leaves an ordinary days alone", async () => {
    expect((await series("7")).body).toHaveLength(7);
  });

  it("still defaults to 30 days when days is absent", async () => {
    const res = await requestApp(app, "GET", "/api/costs?groupBy=day");

    expect(res.body).toHaveLength(30);
  });

  it("still rejects a non-numeric days", async () => {
    const res = await series("abc");

    expect(res.status).toBe(400);
  });

  it("caps one past the maximum at exactly the maximum", async () => {
    expect((await series(String(MAX_COST_DAYS + 1))).body).toHaveLength(MAX_COST_DAYS);
  });

  it("reads days the way parseInt does, so a suffixed or fractional value is truncated", async () => {
    expect((await series("10abc")).body).toHaveLength(10);
    expect((await series("7.9")).body).toHaveLength(7);
  });

  it("rejects an empty days", async () => {
    expect((await series("")).status).toBe(400);
  });

  it("ignores days for other groupings", async () => {
    const res = await requestApp(app, "GET", "/api/costs?groupBy=model&days=100000000");

    expect(res.status).toBe(200);
  });
});

describe("getCostTimeseries clamps days itself", () => {
  // The route clamps too; this guards a future caller (an MCP tool, the CLI)
  // that reaches the loop without going through the route.
  it("caps a direct oversized days", () => {
    expect(getCostTimeseries(db, { days: 100_000_000 })).toHaveLength(MAX_COST_DAYS);
  });

  it("raises a direct non-positive days to one", () => {
    expect(getCostTimeseries(db, { days: 0 })).toHaveLength(1);
  });
});
