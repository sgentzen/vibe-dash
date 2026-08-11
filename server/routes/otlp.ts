import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import { ingestMetricsPayload } from "../ingest/otlp/ingest.js";
import { MalformedOtlpPayloadError } from "../ingest/otlp/parse.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// An exporter posts on its own interval, typically every 60 seconds, and one
// machine may run several agents. The ceiling only has to sit above that.
const otlpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {},
});

// A batch of metric points is larger than a normal API call, so this route gets
// its own body limit rather than raising the global one.
//
// This parser only takes effect because server/index.ts mounts it for this path
// BEFORE the global express.json. body-parser marks a request as parsed and the
// second parser then no-ops, so mounting it here alone would silently leave the
// global 256kb cap in force.
const otlpBody = json({ limit: "1mb" });

export const otlpRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  /**
   * POST /v1/metrics — OTLP/JSON metrics from a coding agent.
   *
   * The path is fixed by the OTLP/HTTP convention: an exporter appends
   * /v1/metrics to whatever endpoint the user configures, so pointing a runner
   * at http://localhost:3001 is the whole of its setup.
   *
   * Responses follow the OTLP contract rather than this repo's { error } shape,
   * because exporters act on the status code: 400 tells a sender not to retry a
   * body that will never parse, and anything retryable is made harmless by the
   * external_id idempotency in the ingest layer.
   *
   * A 400 and a 503 mean opposite things to an exporter, so the two failure
   * classes must not share a catch. `parseMetricsPayload` throws
   * `MalformedOtlpPayloadError` for a body that could never parse, whatever is
   * sent again — that, and only that, is 400. Everything else — a transient
   * DB error mid-transaction, say — has no reason to recur on the exact same
   * bytes, so it is 503: this project treats losing spend as exactly as bad as
   * double counting it, and `external_id` idempotency is what makes a retry of
   * a 503 free rather than risky.
   */
  router.post("/v1/metrics", otlpLimiter, otlpBody, (req, res) => {
    try {
      const result = ingestMetricsPayload(db, req.body);
      if (result.recorded > 0) {
        broadcast({ type: "cost_ingested", payload: {
          filesScanned: 0,
          recordsIngested: result.recorded,
          recordsSkipped: 0,
          unpriced: 0,
          unattributed: result.unattributed,
        } });
      }
      return res.status(200).json({});
    } catch (err) {
      if (err instanceof MalformedOtlpPayloadError) {
        logger.warn({ err }, "rejected a malformed OTLP payload");
        return res.status(400).json({});
      }
      logger.error({ err }, "OTLP ingest failed; asking the exporter to retry");
      return res.status(503).json({});
    }
  });

  return router;
};
