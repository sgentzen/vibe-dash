import Database from "better-sqlite3";
import { initDb } from "../server/db/index.js";

export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  initDb(db);
  return db;
}
