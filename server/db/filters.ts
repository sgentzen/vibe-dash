import type Database from "better-sqlite3";
import type { SavedFilter } from "../types.js";
import { now, genId } from "./helpers.js";

export function createSavedFilter(db: Database.Database, name: string, filterJson: string): SavedFilter {
  const id = genId();
  const ts = now();
  db.prepare("INSERT INTO saved_filters (id, name, filter_json, created_at) VALUES (?, ?, ?, ?)").run(id, name, filterJson, ts);
  return db.prepare("SELECT * FROM saved_filters WHERE id = ?").get(id) as SavedFilter;
}

export function listSavedFilters(db: Database.Database): SavedFilter[] {
  return db.prepare("SELECT * FROM saved_filters ORDER BY created_at DESC").all() as SavedFilter[];
}

export function deleteSavedFilter(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM saved_filters WHERE id = ?").run(id).changes > 0;
}
