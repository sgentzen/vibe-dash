import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  getAgentById,
  cleanupStaleAgents,
  logCost,
  createProject,
  createTask,
  startOrGetSession,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

const LONG_AGO = "2020-01-01T00:00:00.000Z";

/**
 * Push an agent past the staleness cutoff and close any open session, so it
 * becomes a cleanup candidate. registerAgent opens no session of its own, so
 * the second statement is a no-op unless the test opened one.
 */
function makeStale(db: Database.Database, agentId: string): void {
  db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(LONG_AGO, agentId);
  db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE agent_id = ?").run(LONG_AGO, agentId);
}

function newAgent(db: Database.Database, name: string): string {
  return registerAgent(db, { name, model: null, capabilities: [] }).id;
}

describe("cleanupStaleAgents", () => {
  it("removes a stale agent that left nothing behind", () => {
    const id = newAgent(db, "drifter");
    makeStale(db, id);

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, id)).toBeNull();
  });

  it("keeps a stale agent whose cost rows still reference it, without throwing", () => {
    // cost_entries.agent_id is a foreign key with no ON DELETE clause, so
    // SQLite refuses the delete. This used to abort the whole bulk statement
    // and throw out of the MCP server's oninitialized hook, failing the
    // connecting client's registration entirely.
    const id = newAgent(db, "spender");
    logCost(db, {
      agent_id: id,
      model: "claude-opus-5",
      provider: "anthropic",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 1,
    });
    makeStale(db, id);

    expect(() => cleanupStaleAgents(db)).not.toThrow();
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("keeps a stale agent still assigned to a task", () => {
    // A second referencing table, to prove the guard is not specific to cost.
    const project = createProject(db, { name: "demo", description: null });
    const id = newAgent(db, "assignee");
    createTask(db, {
      project_id: project.id,
      title: "wire it up",
      priority: "medium",
      assigned_agent_id: id,
    });
    makeStale(db, id);

    expect(() => cleanupStaleAgents(db)).not.toThrow();
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("still removes the unreferenced agents alongside a referenced one", () => {
    // The regression that mattered: one undeletable agent used to abort the
    // statement, so nothing was cleaned up and the caller got an exception.
    const kept = newAgent(db, "spender");
    logCost(db, {
      agent_id: kept,
      model: "claude-opus-5",
      provider: "anthropic",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 1,
    });
    const goneA = newAgent(db, "drifter-a");
    const goneB = newAgent(db, "drifter-b");
    [kept, goneA, goneB].forEach((id) => makeStale(db, id));

    expect(cleanupStaleAgents(db)).toBe(2);
    expect(getAgentById(db, kept)).not.toBeNull();
    expect(getAgentById(db, goneA)).toBeNull();
    expect(getAgentById(db, goneB)).toBeNull();
  });

  it("leaves an agent with an open session alone even when it is stale", () => {
    // Pre-existing behaviour, pinned so the rewrite cannot quietly drop it.
    // registerAgent does not open a session, so this opens one explicitly.
    const id = newAgent(db, "long-runner");
    startOrGetSession(db, id);
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(LONG_AGO, id);

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("leaves a recently seen agent alone", () => {
    const id = newAgent(db, "busy");

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });
});
