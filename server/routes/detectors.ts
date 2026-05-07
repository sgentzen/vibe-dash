import { Router } from "express";
import type Database from "better-sqlite3";
import { runDetectors, listDetectors } from "../detectors/index.js";
import type { BroadcastFn } from "./types.js";

export function detectorRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // List registered detectors and their metadata.
  router.get("/api/detectors", (_req, res) => {
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
  router.get("/api/detectors/matches", (req, res) => {
    const minScore = req.query.minScore !== undefined ? Number(req.query.minScore) : undefined;
    if (minScore !== undefined && (isNaN(minScore) || minScore < 0 || minScore > 100)) {
      res.status(400).json({ error: "minScore must be a number between 0 and 100" });
      return;
    }

    const detectorId = typeof req.query.detectorId === "string" ? req.query.detectorId : undefined;

    const matches = runDetectors(db, { minScore, detectorId });
    res.json(matches);
  });

  return router;
}
