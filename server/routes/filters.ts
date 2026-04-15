import { Router } from "express";
import type Database from "better-sqlite3";
import { createSavedFilter, listSavedFilters, deleteSavedFilter } from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function filterRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/filters", (_req, res) => {
    res.json(listSavedFilters(db));
  });

  router.post("/api/filters", (req, res) => {
    const { name, filter_json } = req.body as { name: string; filter_json: string };
    if (!name || !filter_json) { res.status(400).json({ error: "name and filter_json are required" }); return; }
    res.status(201).json(createSavedFilter(db, name, filter_json));
  });

  router.delete("/api/filters/:id", (req, res) => {
    res.json({ success: deleteSavedFilter(db, req.params.id) });
  });

  return router;
}
