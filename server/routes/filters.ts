import { Router } from "express";
import type Database from "better-sqlite3";
import { createSavedFilter, listSavedFilters, deleteSavedFilter } from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { validateBody } from "./validate.js";
import { createSavedFilterSchema } from "../../shared/schemas.js";

export function filterRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/filters", (_req, res) => {
    res.json(listSavedFilters(db));
  });

  router.post("/api/filters", validateBody(createSavedFilterSchema), (req, res) => {
    const { name, filter_json } = req.body as { name: string; filter_json: string };
    res.status(201).json(createSavedFilter(db, name, filter_json));
  });

  router.delete("/api/filters/:id", (req, res) => {
    res.json({ success: deleteSavedFilter(db, req.params.id) });
  });

  return router;
}
