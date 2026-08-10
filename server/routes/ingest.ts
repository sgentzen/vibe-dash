import { Router } from "express";
import rateLimit from "express-rate-limit";
import type Database from "better-sqlite3";
import { logger } from "../logger.js";
import { syncTranscripts, getIngestStatus } from "../ingest/transcripts/sync.js";
import { knownModels } from "../ingest/transcripts/pricing.js";
import { linkProjectPath, listProjectPaths, unlinkProjectPath, RootPathError } from "../db/projectPaths.js";
import type { BroadcastFn, RouteFactory } from "./types.js";

// A scan walks the filesystem, so it is far more expensive than a normal read.
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many ingest scans, please try again later." },
});

export const ingestRoutes: RouteFactory = (db: Database.Database, broadcast: BroadcastFn): Router => {
  const router = Router();

  /** GET /api/ingest/status — what has been ingested, and what is unresolved. */
  router.get("/api/ingest/status", (_req, res) => {
    res.json({ ...getIngestStatus(db), knownModels: knownModels() });
  });

  /** POST /api/ingest/scan — read new transcript records now. */
  router.post("/api/ingest/scan", scanLimiter, async (_req, res) => {
    try {
      const result = await syncTranscripts(db);
      if (result.recordsIngested > 0) {
        broadcast({ type: "cost_ingested", payload: result });
      }
      res.json(result);
    } catch (err) {
      logger.error({ err }, "transcript scan failed");
      res.status(500).json({ error: "Transcript scan failed" });
    }
  });

  /** GET /api/ingest/paths — directory-to-project links. */
  router.get("/api/ingest/paths", (_req, res) => {
    res.json({ paths: listProjectPaths(db) });
  });

  /**
   * POST /api/ingest/paths — link a directory to a project.
   *
   * Always explicit. The ingestion path never creates these itself, because a
   * silent wrong attribution puts money against the wrong project and cannot be
   * spotted from the UI.
   */
  router.post("/api/ingest/paths", (req, res) => {
    const { project_id: projectId, path: rawPath } = req.body as { project_id?: string; path?: string };
    if (!projectId || !rawPath) {
      return res.status(400).json({ error: "project_id and path are required" });
    }

    const project = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    try {
      const id = linkProjectPath(db, projectId, rawPath);
      broadcast({ type: "project_path_linked", payload: { id, project_id: projectId } });
      return res.status(201).json({ id });
    } catch (err) {
      if (err instanceof RootPathError) {
        return res.status(400).json({ error: err.message });
      }
      // Only the UNIQUE constraint on path means "already linked". Reporting
      // every other throw as 409 told the caller their path was a duplicate
      // when the real fault was ours, and hid the actual error behind a status
      // that reads as "nothing to do here".
      if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
        logger.warn({ err, projectId }, "project path already linked");
        return res.status(409).json({ error: "That path is already linked to a project" });
      }
      logger.error({ err, projectId }, "project path link failed");
      return res.status(500).json({ error: "Failed to link path" });
    }
  });

  /** DELETE /api/ingest/paths/:id */
  router.delete("/api/ingest/paths/:id", (req, res) => {
    const removed = unlinkProjectPath(db, req.params.id);
    if (!removed) return res.status(404).json({ error: "Path link not found" });
    broadcast({ type: "project_path_unlinked", payload: { id: req.params.id } });
    return res.status(204).end();
  });

  return router;
};
