import { Router } from "express";
import type Database from "better-sqlite3";
import {
  isAiConfigured,
  generateDigest,
  queryNaturalLanguage,
  getDigestAnomalies,
  shouldSendDigest,
} from "../intelligence.js";
import { makeReadLimiter } from "./middleware.js";
import rateLimit from "express-rate-limit";
import type { BroadcastFn } from "./types.js";

export function intelligenceRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // Cheap reads share a per-route budget (status / anomalies / should-send).
  // Kept separate from /api/stats and /api/detectors/* so polling-heavy
  // dashboard presets don't trip each other's limit. See PR #86.
  const intelligenceReadLimiter = makeReadLimiter(120);

  // AI-call endpoints are tight: each request burns Anthropic tokens, so a
  // 60/min global cap is intentionally low.
  const aiCallLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });

  // GET /api/intelligence/status — whether AI is configured.
  router.get("/api/intelligence/status", intelligenceReadLimiter, (_req, res) => {
    res.json({ configured: isAiConfigured() });
  });

  // GET /api/intelligence/digest?period=daily|weekly&projectId=...
  // Generate an AI-written digest. 503 when ANTHROPIC_API_KEY not configured.
  router.get("/api/intelligence/digest", aiCallLimiter, async (req, res) => {
    if (!isAiConfigured()) {
      res.status(503).json({ error: "AI not configured — set ANTHROPIC_API_KEY" });
      return;
    }
    const period = req.query.period === "weekly" ? "weekly" : "daily";
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    try {
      const digest = await generateDigest(db, period, projectId);
      res.json({ period, digest });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Digest generation failed" });
    }
  });

  // POST /api/intelligence/query — natural-language question about project data.
  router.post("/api/intelligence/query", aiCallLimiter, async (req, res) => {
    if (!isAiConfigured()) {
      res.status(503).json({ error: "AI not configured — set ANTHROPIC_API_KEY" });
      return;
    }
    const { question, projectId } = req.body as { question?: string; projectId?: string };
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "question is required" });
      return;
    }
    try {
      const answer = await queryNaturalLanguage(db, question.trim(), projectId);
      res.json({ answer });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Query failed" });
    }
  });

  // GET /api/intelligence/anomalies?minScore=50&limit=10
  // Run detectors and return formatted anomaly list for digest/push triggers.
  // Does not require ANTHROPIC_API_KEY.
  router.get("/api/intelligence/anomalies", intelligenceReadLimiter, (req, res) => {
    const rawMin = req.query.minScore;
    const rawLimit = req.query.limit;

    let minScore = 50;
    if (rawMin !== undefined) {
      const n = Number(String(rawMin).trim());
      if (isNaN(n) || n < 0 || n > 100) {
        res.status(400).json({ error: "minScore must be 0–100" });
        return;
      }
      minScore = n;
    }

    let limit = 10;
    if (rawLimit !== undefined) {
      const n = Number(String(rawLimit).trim());
      if (isNaN(n) || n < 1 || n > 100) {
        res.status(400).json({ error: "limit must be 1–100" });
        return;
      }
      limit = Math.round(n);
    }

    const anomalies = getDigestAnomalies(db, limit, minScore);
    res.json({ anomalies, shouldSend: anomalies.length > 0 });
  });

  // GET /api/intelligence/should-send?threshold=50
  // "Silent when fine" check — returns { shouldSend: boolean }.
  router.get("/api/intelligence/should-send", intelligenceReadLimiter, (req, res) => {
    const rawThreshold = req.query.threshold;
    let threshold = 50;
    if (rawThreshold !== undefined) {
      const n = Number(String(rawThreshold).trim());
      if (isNaN(n) || n < 0 || n > 100) {
        res.status(400).json({ error: "threshold must be 0–100" });
        return;
      }
      threshold = n;
    }
    res.json({ shouldSend: shouldSendDigest(db, threshold) });
  });

  return router;
}
