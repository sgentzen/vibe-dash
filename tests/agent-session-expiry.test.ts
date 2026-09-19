import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, startOrGetSession } from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

/**
 * A blank or otherwise unparseable `last_activity_at` used to skip expiry
 * silently: `new Date('').getTime()` is NaN, and `NaN > SESSION_TIMEOUT_MS` is
 * false, so the reuse branch ran and reset the session clock to now no matter
 * how old the session was. Expiry has to fail closed on a value it cannot read.
 */
describe("session expiry with an unparseable last_activity_at", () => {
  function agentWithOpenSession(): { agentId: string; sessionId: string } {
    const agent = registerAgent(db, { name: "bot", model: null, capabilities: [] });
    const session = startOrGetSession(db, agent.id);
    return { agentId: agent.id, sessionId: session.id };
  }

  function blankOutActivity(sessionId: string): void {
    db.prepare("UPDATE agent_sessions SET last_activity_at = '' WHERE id = ?").run(sessionId);
  }

  it("closes a session whose last_activity_at is blank instead of reusing it", () => {
    const { agentId, sessionId } = agentWithOpenSession();
    blankOutActivity(sessionId);

    const next = startOrGetSession(db, agentId);

    expect(next.id).not.toBe(sessionId);
    expect(next.activity_count).toBe(1);
    expect(next.ended_at).toBeNull();
  });

  it("marks the abandoned session ended so it stops being a candidate", () => {
    const { agentId, sessionId } = agentWithOpenSession();
    blankOutActivity(sessionId);

    startOrGetSession(db, agentId);

    const old = db
      .prepare("SELECT ended_at FROM agent_sessions WHERE id = ?")
      .get(sessionId) as { ended_at: string | null };
    expect(old.ended_at).not.toBeNull();
  });

  it("closes a session whose last_activity_at is not a date at all", () => {
    const { agentId, sessionId } = agentWithOpenSession();
    db.prepare("UPDATE agent_sessions SET last_activity_at = 'not-a-date' WHERE id = ?").run(sessionId);

    const next = startOrGetSession(db, agentId);

    expect(next.id).not.toBe(sessionId);
  });

  it("still reuses a session whose last_activity_at is recent", () => {
    const { agentId, sessionId } = agentWithOpenSession();

    const next = startOrGetSession(db, agentId);

    expect(next.id).toBe(sessionId);
    expect(next.activity_count).toBe(2);
  });
});
