import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type Database from "better-sqlite3";
import {
  createIngestionSource,
  listIngestionSources,
  getIngestionSourceById,
  deleteIngestionSource,
  rotateIngestionToken,
  enqueueIngestionEvent,
  listIngestionEvents,
} from "../db/ingestion.js";
import { normalize } from "./normalizer.js";
import { makeSourceAuthMiddleware } from "./auth.js";
import { requireRoleWhenEnabled } from "../auth.js";
import { runMaterializer } from "./materializer.js";
import { badRequest, notFound } from "../routes/responses.js";
import { validateBody } from "../routes/validate.js";
import type { IngestionSourceKind } from "../db/ingestion.js";
import type { BroadcastFn } from "../routes/types.js";
import { broadcast } from "../websocket.js";

const SOURCE_KINDS: IngestionSourceKind[] = ["claude_code", "cursor", "codex", "copilot", "aider", "generic"];

const ingestLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const adminLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const createSourceSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["claude_code", "cursor", "codex", "copilot", "aider", "generic"]),
  project_id: z.string().optional().nullable(),
});

export function ingestionRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();
  const sourceAuth = makeSourceAuthMiddleware(db);
  const adminAuth = requireRoleWhenEnabled(db, "admin", "developer");

  // ── Source management must come BEFORE /:source_kind to avoid param capture ──

  // ── Source management (admin/developer only when auth enabled) ───────────────
  router.post("/api/ingest/sources", adminLimiter, adminAuth, validateBody(createSourceSchema), (req, res) => {
    const { name, kind, project_id } = req.body as z.infer<typeof createSourceSchema>;
    if (project_id) {
      const proj = db.prepare("SELECT id FROM projects WHERE id = ?").get(project_id);
      if (!proj) { badRequest(res, "project not found"); return; }
    }
    const result = createIngestionSource(db, { name, kind, project_id: project_id ?? null });
    broadcast({ type: "ingestion_source_created", payload: { id: result.id, name: result.name, kind: result.kind } });
    res.status(201).json(result);
  });

  router.get("/api/ingest/sources", adminLimiter, adminAuth, (_req, res) => {
    res.json(listIngestionSources(db));
  });

  router.delete("/api/ingest/sources/:id", adminLimiter, adminAuth, (req, res) => {
    const deleted = deleteIngestionSource(db, req.params.id as string);
    if (!deleted) { notFound(res, "Ingestion source not found"); return; }
    res.status(204).send();
  });

  router.post("/api/ingest/sources/:id/rotate", adminLimiter, adminAuth, (req, res) => {
    const result = rotateIngestionToken(db, req.params.id as string);
    if (!result) { notFound(res, "Ingestion source not found"); return; }
    res.json(result);
  });

  // ── Event log (debug/replay) ─────────────────────────────────────────────────
  router.get("/api/ingest/events", adminLimiter, adminAuth, (req, res) => {
    const source_id = req.query.source_id as string | undefined;
    const since = req.query.since as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
    res.json(listIngestionEvents(db, { source_id, since, limit }));
  });

  // ── Ingest event ────────────────────────────────────────────────────────────
  router.post("/api/ingest/:source_kind", ingestLimiter, sourceAuth, (req, res) => {
    const kind = req.params.source_kind as IngestionSourceKind;
    if (!SOURCE_KINDS.includes(kind)) { badRequest(res, `Unknown source kind: ${kind}`); return; }

    const source = req.ingestionSource!;
    const payload = (req.body ?? {}) as Record<string, unknown>;

    const normalized = normalize(kind, payload);

    const event = enqueueIngestionEvent(db, {
      source_id: source.id,
      raw_payload: JSON.stringify(payload),
      normalized_kind: normalized?.kind ?? "activity",
      task_id: normalized?.task_id ?? null,
      agent_id: null,
    });

    // Kick the materializer immediately (non-blocking)
    setImmediate(() => runMaterializer(db));

    res.status(202).json({ queued: true, event_id: event.id });
  });

  // ── Heartbeat ────────────────────────────────────────────────────────────────
  router.post("/api/ingest/:source_kind/heartbeat", ingestLimiter, sourceAuth, (_req, res) => {
    res.status(204).send();
  });

  return router;
}
