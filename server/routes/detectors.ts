import { Router } from "express";
import type Database from "better-sqlite3";
import { runDetectors, listDetectors } from "../detectors/index.js";
import { makeReadLimiter } from "./middleware.js";
import type { BroadcastFn } from "./types.js";

export function detectorRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // Per-route limiter so the dashboard's HotSpots preset polling doesn't
  // share a budget with /api/stats or /api/intelligence/*. See PR #86.
  const detectorsLimiter = makeReadLimiter(120);

  // List registered detectors and their metadata.
  router.get("/api/detectors", detectorsLimiter, (_req, res) => {
    const detectors = listDetectors().map((d) => ({
      id: d.id,
      category: d.category,
      defaultThreshold: d.defaultThreshold,
    }));
    res.json(detectors);
  });

  // Run all detectors and return scored matches sorted by score descending.
  // Query params:
  //   minScore=0-100  — suppress matches below this score (defaults to per-detector threshold)
  //   detectorId=id   — run only the named detector
  router.get("/api/detectors/matches", detectorsLimiter, (req, res) => {
    const raw = req.query.minScore;
    let minScore: number | undefined;
    if (raw !== undefined) {
      const str = String(raw).trim();
      if (str === "") {
        res.status(400).json({ error: "minScore must be a number between 0 and 100" });
        return;
      }
      minScore = Number(str);
      if (isNaN(minScore) || minScore < 0 || minScore > 100) {
        res.status(400).json({ error: "minScore must be a number between 0 and 100" });
        return;
      }
    }

    const detectorId = typeof req.query.detectorId === "string" ? req.query.detectorId : undefined;

    const matches = runDetectors(db, { minScore, detectorId });
    res.json(matches);
  });

  return router;
}
