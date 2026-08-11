import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { otlpRoutes } from "../server/routes/otlp.js";
import { getIngestStatus } from "../server/ingest/transcripts/sync.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(otlpRoutes(db, () => {}));
});

function codexPayload(input: number, project?: string): unknown {
  return {
    resourceMetrics: [{
      resource: {
        attributes: project ? [{ key: "vibe_dash.project", value: { stringValue: project } }] : [],
      },
      scopeMetrics: [{
        scope: { name: "codex" },
        metrics: [{
          name: "codex.turn.token_usage",
          histogram: {
            aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
            dataPoints: [{
              attributes: [
                { key: "token_type", value: { stringValue: "input" } },
                { key: "model", value: { stringValue: "gpt-5.3-codex" } },
              ],
              startTimeUnixNano: "1000",
              timeUnixNano: "2000",
              count: "1",
              sum: input,
            }],
          },
        }],
      }],
    }],
  };
}

describe("POST /v1/metrics", () => {
  it("accepts a Codex export and records it", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", codexPayload(100));

    expect(res.status).toBe(200);
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'otlp'").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("returns an empty ExportMetricsServiceResponse, as OTLP requires", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", codexPayload(100));
    expect(res.body).toEqual({});
  });

  it("rejects a body that is not an OTLP object with 400 and writes nothing", async () => {
    // A JSON array specifically: express.json accepts it, so it reaches our
    // handler and exercises the route's own 400 path. A bare string would be
    // rejected by the body parser first and would only prove body-parser works.
    const res = await requestApp(app, "POST", "/v1/metrics", []);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({});
    const count = db.prepare("SELECT COUNT(*) AS n FROM cost_entries").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("accepts an empty payload without error", async () => {
    const res = await requestApp(app, "POST", "/v1/metrics", { resourceMetrics: [] });
    expect(res.status).toBe(200);
  });

  it("broadcasts when rows were recorded", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(otlpRoutes(db, (e) => { events.push(e as { type: string }); }));

    await requestApp(app, "POST", "/v1/metrics", codexPayload(100));
    expect(events.map((e) => e.type)).toContain("cost_ingested");
  });

  it("does not broadcast when nothing was recorded", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(otlpRoutes(db, (e) => { events.push(e as { type: string }); }));

    await requestApp(app, "POST", "/v1/metrics", { resourceMetrics: [] });
    expect(events).toHaveLength(0);
  });
});

describe("the ingest status reports OTLP", () => {
  it("counts recorded, unmapped and unattributed points", async () => {
    await requestApp(app, "POST", "/v1/metrics", codexPayload(100));

    const status = getIngestStatus(db);
    expect(status.otlpRows).toBe(1);
    expect(status.otlpUnattributed).toBe(1);
  });

  it("does not count an attributed row as unattributed", async () => {
    createProject(db, { name: "demo", description: null });
    await requestApp(app, "POST", "/v1/metrics", codexPayload(100, "demo"));

    expect(getIngestStatus(db).otlpUnattributed).toBe(0);
  });

  it("counts a point no mapper recognises as unmapped, and still returns 200", async () => {
    // A metric name no mapper reads: it parses fine (it is structurally valid
    // OTLP) but mapPoint returns null for it, which is the "unmapped" path —
    // distinct from the 400 case above, where the body itself is rejected.
    const before = getIngestStatus(db).otlpUnmapped;
    const payload = {
      resourceMetrics: [{
        resource: { attributes: [] },
        scopeMetrics: [{
          scope: { name: "some-other-runner" },
          metrics: [{
            name: "some_other_runner.turn.token_usage",
            histogram: {
              aggregationTemporality: "AGGREGATION_TEMPORALITY_DELTA",
              dataPoints: [{ attributes: [], startTimeUnixNano: "1000", timeUnixNano: "2000", sum: 42 }],
            },
          }],
        }],
      }],
    };

    const res = await requestApp(app, "POST", "/v1/metrics", payload);

    expect(res.status).toBe(200);
    expect(getIngestStatus(db).otlpUnmapped).toBe(before + 1);
  });
});
