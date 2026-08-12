import { Router } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import { ingestMetricsPayload } from "../ingest/otlp/ingest.js";
import { MalformedOtlpPayloadError } from "../ingest/otlp/parse.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// An exporter posts on its own interval, typically every 60 seconds, and one
// machine may run several agents. The ceiling only has to sit above that.
//
// Exported rather than applied here as route middleware: it is mounted in
// server/index.ts, ahead of even the 1mb body parser for this path, so an
// excess request is rejected before its body is ever read. See the ordering
// comment there for why the parser cannot come first. `express-rate-limit`
// counts per INSTANCE of the limiter it returns, not per path, so this must
// be applied exactly once across the app -- mounting it here as well as in
// index.ts would consume the same budget twice per request and start
// rejecting at half the intended rate.
export const otlpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {},
});

// The 1mb body limit for this path is NOT set here. It is mounted in
// server/index.ts, ahead of the global express.json, because body-parser marks
// a request as parsed and any later parser then no-ops. A parser mounted here
// would never run, and would leave a reader believing this route enforces its
// own limit when the global 256kb cap was really the one in force.

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
  router.post("/v1/metrics", (req, res) => {
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
