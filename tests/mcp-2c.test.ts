import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

describe("migration 016 — agent status columns", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("adds current_status and current_status_at to agents", () => {
    const cols = (db.pragma("table_info(agents)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("current_status");
    expect(cols).toContain("current_status_at");
  });
});
