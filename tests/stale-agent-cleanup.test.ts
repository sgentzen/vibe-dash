import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { NON_INSTANT_SHAPES } from "./timestamp-shapes.js";
import { SESSION_TIMEOUT_MS } from "../server/constants.js";
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

/**
 * cleanupStaleAgents reads last_seen_at, and had neither of the guards
 * closeStaleSession carries on last_activity_at. `julianday('now')`
 * re-evaluates on every pass, so an agent whose last_seen_at was the literal
 * string 'now' was never past the cutoff and was invisible to housekeeping for
 * good; a value dated ahead of the present outran every cutoff the same way.
 * Agents here have no session rows, so the open-session guard and the foreign
 * key are out of the picture and only the timestamp decides.
 */
describe("cleanupStaleAgents bounds last_seen_at on both sides of the present", () => {
  const AHEAD = (ms: number) => new Date(Date.now() + ms).toISOString();
  const MARGIN_MS = 5_000;

  function agentSeenAt(name: string, lastSeenAt: string): string {
    const id = newAgent(db, name);
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, id);
    return id;
  }

  it.each(NON_INSTANT_SHAPES)("removes an agent whose last_seen_at is %s", (name, value) => {
    const id = agentSeenAt(`shape-${name}`, value);

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, id)).toBeNull();
  });

  it("removes an agent dated further ahead than the timeout", () => {
    const id = agentSeenAt("from-the-future", AHEAD(SESSION_TIMEOUT_MS + MARGIN_MS));

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, id)).toBeNull();
  });

  it("removes an agent dated years ahead", () => {
    const id = agentSeenAt("never-stale", "2099-01-01T00:00:00.000Z");

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, id)).toBeNull();
  });

  it("keeps an agent dated ahead by less than the timeout", () => {
    // Skew between the processes sharing a VIBE_DASH_DB, not a fault.
    const id = agentSeenAt("skewed-clock", AHEAD(SESSION_TIMEOUT_MS - MARGIN_MS));

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("keeps an agent stamped a moment ago by another process", () => {
    const id = agentSeenAt("just-wrote", AHEAD(50));

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("still keeps a badly stamped agent that something references", () => {
    // The foreign-key refusal is deliberate and must survive the wider net.
    const id = agentSeenAt("spender", "now");
    logCost(db, {
      agent_id: id,
      model: "claude-opus-5",
      provider: "anthropic",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 1,
    });

    expect(() => cleanupStaleAgents(db)).not.toThrow();
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("keeps a badly stamped agent dated far in the future that something references", () => {
    // The FK-referenced test above covers the shape reason (last_seen_at
    // 'now'); this covers the other candidate reason on this same widened net,
    // julianday(last_seen_at) > julianday(noLaterThan), so both paths into the
    // candidates query are proven to hit the same skip-if-referenced guard.
    const id = agentSeenAt("future-spender", "2099-01-01T00:00:00.000Z");
    logCost(db, {
      agent_id: id,
      model: "claude-opus-5",
      provider: "anthropic",
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 1,
    });

    expect(() => cleanupStaleAgents(db)).not.toThrow();
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("sorts a mixed batch in one sweep", () => {
    const kept = [newAgent(db, "busy"), agentSeenAt("skewed", AHEAD(MARGIN_MS))];
    const gone = [
      agentSeenAt("literal-now", "now"),
      agentSeenAt("future", "2099-01-01T00:00:00.000Z"),
      agentSeenAt("long-ago", LONG_AGO),
    ];

    expect(cleanupStaleAgents(db)).toBe(gone.length);
    kept.forEach((id) => expect(getAgentById(db, id)).not.toBeNull());
    gone.forEach((id) => expect(getAgentById(db, id)).toBeNull());
  });

  it("leaves a badly stamped agent alone while it holds an open session", () => {
    const id = agentSeenAt("mid-session", "now");
    startOrGetSession(db, id);

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("removes an agent whose last_seen_at is blank", () => {
    const id = agentSeenAt("blank", "");

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, id)).toBeNull();
  });

  it("keeps an agent just inside the past cutoff and removes one just outside", () => {
    const inside = agentSeenAt("just-inside", new Date(Date.now() - SESSION_TIMEOUT_MS + MARGIN_MS).toISOString());
    const outside = agentSeenAt("just-outside", new Date(Date.now() - SESSION_TIMEOUT_MS - MARGIN_MS).toISOString());

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(getAgentById(db, inside)).not.toBeNull();
    expect(getAgentById(db, outside)).toBeNull();
  });
});

/**
 * Exact equality at both bounds, on a frozen clock.
 *
 * cutoff and noLaterThan are both built from Date.now() inside
 * cleanupStaleAgents itself, so landing on them exactly needs the test and the
 * function to read the same instant — a real clock tick between computing the
 * expected bound here and the function recomputing it would otherwise nudge
 * the row off the line. Both comparisons are strict (`<` / `>`), so a
 * last_seen_at exactly on either bound must be kept, not removed.
 */
describe("cleanupStaleAgents at exact boundary equality (frozen clock)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function agentSeenAt(name: string, lastSeenAt: string): string {
    const id = newAgent(db, name);
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, id);
    return id;
  }

  it("keeps an agent whose last_seen_at exactly equals the past cutoff", () => {
    const fixedNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const cutoff = new Date(fixedNow - SESSION_TIMEOUT_MS).toISOString();
    const id = agentSeenAt("exact-past-cutoff", cutoff);

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });

  it("keeps an agent whose last_seen_at exactly equals noLaterThan", () => {
    const fixedNow = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const noLaterThan = new Date(fixedNow + SESSION_TIMEOUT_MS).toISOString();
    const id = agentSeenAt("exact-nolaterthan", noLaterThan);

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(getAgentById(db, id)).not.toBeNull();
  });
});

