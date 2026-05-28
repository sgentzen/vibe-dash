import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, setAgentStatus, getAgentByName } from "../server/db/index.js";

describe("migration 016 — agent status columns", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("adds current_status and current_status_at to agents", () => {
    const cols = (db.pragma("table_info(agents)") as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("current_status");
    expect(cols).toContain("current_status_at");
  });
});

describe("setAgentStatus", () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  it("sets and overwrites the agent's current status", () => {
    registerAgent(db, { name: "coder-1", model: null, capabilities: [] });
    setAgentStatus(db, "coder-1", "running tests");
    let a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("running tests");
    expect(a.current_status_at).toBeTruthy();
    setAgentStatus(db, "coder-1", "writing migration");
    a = getAgentByName(db, "coder-1")!;
    expect(a.current_status).toBe("writing migration");
  });
});
