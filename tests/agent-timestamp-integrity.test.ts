import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  getAgentStats,
  getAgentHealthStatus,
  closeStaleSession,
  cleanupStaleAgents,
  createProject,
  createTask,
  logActivity,
  completeTask,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

const LONG_AGO = "2020-01-01T00:00:00.000Z";

function newAgent(name: string): string {
  return registerAgent(db, { name, model: null, capabilities: [] }).id;
}

/**
 * Insert a session row directly. The unreadable timestamps these tests pin
 * behaviour on cannot be produced through the public API, so the row has to be
 * written as the corruption would leave it.
 */
function addSession(
  agentId: string,
  row: { started_at: string; ended_at?: string | null; last_activity_at: string; activity_count: number }
): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_id, started_at, ended_at, last_activity_at, tasks_touched, activity_count)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, agentId, row.started_at, row.ended_at ?? null, row.last_activity_at, row.activity_count);
  return id;
}

/** A closed session spanning exactly one hour, carrying `activity_count` activities. */
function addMeasurableSession(agentId: string, activityCount: number): void {
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const ended = new Date().toISOString();
  addSession(agentId, {
    started_at: started,
    ended_at: ended,
    last_activity_at: ended,
    activity_count: activityCount,
  });
}

/**
 * `julianday()` returns NULL for a string it cannot read, two-argument
 * `MAX(NULL, 0.01)` is NULL, and `SUM` skips a NULL. The row therefore fell out
 * of the hours denominator while `SUM(activity_count)` still counted it in the
 * numerator: 500 activities from an unmeasurable session on top of a real
 * 5-activity hour reported 505/hr, with no error anywhere.
 */
describe("getAgentStats activity_frequency with unreadable session timestamps", () => {
  it("reports the rate of the measurable sessions alone", () => {
    const id = newAgent("steady");
    addMeasurableSession(id, 5);

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("drops a session with an unreadable started_at from both sides of the rate", () => {
    const id = newAgent("corrupt-start");
    addMeasurableSession(id, 5);
    addSession(id, {
      started_at: "not-a-date",
      ended_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("drops an open session whose last_activity_at is blank", () => {
    const id = newAgent("blank-activity");
    addMeasurableSession(id, 5);
    addSession(id, {
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ended_at: null,
      last_activity_at: "",
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("drops an open session whose last_activity_at is not a date at all", () => {
    const id = newAgent("garbage-activity");
    addMeasurableSession(id, 5);
    addSession(id, {
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ended_at: null,
      last_activity_at: "not-a-date",
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("drops a session whose ended_at is unreadable even though last_activity_at is fine", () => {
    // COALESCE picks ended_at first, so a garbage ended_at masks a perfectly
    // good last_activity_at. The gate has to reject on what COALESCE actually
    // returns, not on whether some readable timestamp exists on the row.
    const id = newAgent("corrupt-end");
    addMeasurableSession(id, 5);
    addSession(id, {
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ended_at: "not-a-date",
      last_activity_at: new Date().toISOString(),
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("keeps every readable session when readable and unreadable rows are mixed", () => {
    // Two good hours and two bad rows: 10 activities over 2 measurable hours.
    // Proves the gate drops only what it cannot measure, rather than taking
    // readable rows down with it.
    const id = newAgent("mixed");
    addMeasurableSession(id, 5);
    addMeasurableSession(id, 5);
    addSession(id, {
      started_at: "not-a-date",
      ended_at: null,
      last_activity_at: new Date().toISOString(),
      activity_count: 500,
    });
    addSession(id, {
      started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ended_at: null,
      last_activity_at: "",
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(5);
  });

  it("reports zero rather than a fabricated rate when nothing is measurable", () => {
    const id = newAgent("all-corrupt");
    addSession(id, {
      started_at: "not-a-date",
      ended_at: null,
      last_activity_at: "not-a-date",
      activity_count: 500,
    });

    expect(getAgentStats(db, id).activity_frequency).toBe(0);
  });
});

/**
 * Housekeeping used to compare raw ISO strings against a cutoff. `'' < cutoff`
 * is true, so a blank value was closed by accident, but `'not-a-date' < cutoff`
 * is false because letters sort above digits — a non-date timestamp was
 * invisible to housekeeping forever, in code that runs unattended from the MCP
 * server's oninitialized hook.
 *
 * The helper writes the same value to both timestamps, as the public API does,
 * so these cases say nothing about which column housekeeping reads — that is
 * `closeStaleSession` measures idleness, not session age, and
 * tests/agent-session-staleness.test.ts is where the two are pulled apart.
 * What is pinned here is the parsing: whatever column is read, a value
 * julianday() cannot make sense of has to be treated as stale rather than
 * quietly outranking the cutoff.
 */
describe("closeStaleSession with an unreadable timestamp", () => {
  function openSession(timestamp: string): string {
    const id = newAgent(`holder-${randomUUID().slice(0, 8)}`);
    return addSession(id, { started_at: timestamp, last_activity_at: timestamp, activity_count: 1 });
  }

  function endedAtOf(sessionId: string): string | null {
    return (db.prepare("SELECT ended_at FROM agent_sessions WHERE id = ?").get(sessionId) as {
      ended_at: string | null;
    }).ended_at;
  }

  it("closes a session whose timestamps are not dates", () => {
    const sessionId = openSession("not-a-date");

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("closes a session whose timestamps are blank", () => {
    const sessionId = openSession("");

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("closes a session whose timestamps are both before the cutoff", () => {
    const sessionId = openSession(LONG_AGO);

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("leaves a session with recent timestamps open", () => {
    const sessionId = openSession(new Date().toISOString());

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
  });
});

describe("cleanupStaleAgents with an unreadable last_seen_at", () => {
  function agentSeenAt(name: string, lastSeenAt: string): string {
    const id = newAgent(name);
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, id);
    return id;
  }

  function exists(agentId: string): boolean {
    return db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agentId) !== undefined;
  }

  it("removes an agent whose last_seen_at is not a date", () => {
    const id = agentSeenAt("garbage-seen", "not-a-date");

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(exists(id)).toBe(false);
  });

  it("removes an agent whose last_seen_at is blank", () => {
    const id = agentSeenAt("blank-seen", "");

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(exists(id)).toBe(false);
  });

  it("leaves an agent with an open session alone even when last_seen_at is unreadable", () => {
    // Treating an unreadable timestamp as stale must not reach past the
    // open-session guard. An agent still holding a session is working,
    // whatever its last_seen_at says.
    const id = agentSeenAt("garbage-but-live", "not-a-date");
    addSession(id, {
      started_at: new Date().toISOString(),
      ended_at: null,
      last_activity_at: new Date().toISOString(),
      activity_count: 1,
    });

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(exists(id)).toBe(true);
  });

  it("leaves a recently seen agent alone", () => {
    const id = agentSeenAt("busy", new Date().toISOString());

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(exists(id)).toBe(true);
  });
});

/**
 * The two housekeeping functions run back to back from the MCP server's
 * oninitialized hook, so the pass that matters is both of them together: an
 * abandoned agent whose timestamps were unreadable used to survive every pass
 * untouched, because neither function could see it.
 */
describe("housekeeping pass over an agent with unreadable timestamps", () => {
  function ghostWithSession(): string {
    const id = newAgent("ghost");
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run("not-a-date", id);
    addSession(id, {
      started_at: "not-a-date",
      ended_at: null,
      last_activity_at: "not-a-date",
      activity_count: 1,
    });
    return id;
  }

  it("closes the session the first pass could not see", () => {
    const id = ghostWithSession();

    expect(closeStaleSession(db)).toBe(1);

    const open = db
      .prepare("SELECT COUNT(*) AS c FROM agent_sessions WHERE agent_id = ? AND ended_at IS NULL")
      .get(id) as { c: number };
    expect(open.c).toBe(0);
  });

  it("keeps the agent itself, because its session row still references it", () => {
    // Closing the session drops the open-session guard, so the agent does
    // become a deletion candidate — and the foreign key on
    // agent_sessions.agent_id then refuses the delete. Worth pinning: it means
    // the protection for an agent with work on record survives the two
    // functions running back to back, which the guard alone would not.
    const id = ghostWithSession();

    closeStaleSession(db);

    expect(cleanupStaleAgents(db)).toBe(0);
    expect(db.prepare("SELECT 1 FROM agents WHERE id = ?").get(id)).not.toBeUndefined();
  });

  it("removes an agent that left no session behind at all", () => {
    const id = newAgent("bare-ghost");
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run("not-a-date", id);

    closeStaleSession(db);

    expect(cleanupStaleAgents(db)).toBe(1);
    expect(db.prepare("SELECT 1 FROM agents WHERE id = ?").get(id)).toBeUndefined();
  });
});

/**
 * Regression guard. NaN comparisons already fall through to "offline", which is
 * the safe answer for a timestamp we cannot read, but nothing pinned it — a
 * refactor could flip it to "active" and report a dead agent as healthy.
 */
describe("getAgentHealthStatus with an unreadable last_seen_at", () => {
  it("reports offline for a blank timestamp", () => {
    expect(getAgentHealthStatus("")).toBe("offline");
  });

  it("reports offline for a timestamp that is not a date", () => {
    expect(getAgentHealthStatus("not-a-date")).toBe("offline");
  });

  it("still reports active for a timestamp from just now", () => {
    expect(getAgentHealthStatus(new Date().toISOString())).toBe("active");
  });
});

/**
 * Regression guard on the sibling aggregate. avg_completion_time divides with
 * AVG(), which skips a NULL row on both sides at once, so an unreadable
 * timestamp already fails closed there — unlike activity_frequency, whose
 * numerator and denominator came from separate aggregates and could disagree.
 * That safety is a property of AVG, not something the query states, so it is
 * worth pinning next to the bug it resembles.
 */
describe("getAgentStats avg_completion_time with an unreadable task timestamp", () => {
  function completedTask(agentId: string, projectId: string, title: string): string {
    const task = createTask(db, { project_id: projectId, title, description: null, priority: "medium" });
    logActivity(db, { task_id: task.id, agent_id: agentId, message: "working" });
    completeTask(db, task.id);
    return task.id;
  }

  it("ignores a task whose updated_at cannot be read", () => {
    const id = newAgent("completer");
    const project = createProject(db, { name: "P", description: null });
    const good = completedTask(id, project.id, "readable");
    const bad = completedTask(id, project.id, "corrupt");
    // An hour between first activity and completion, against a task whose
    // completion time cannot be computed at all.
    db.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?")
      .run(new Date(Date.now() + 60 * 60 * 1000).toISOString(), good);
    db.prepare("UPDATE tasks SET updated_at = 'not-a-date' WHERE id = ?").run(bad);

    const avg = getAgentStats(db, id).avg_completion_time_seconds;

    expect(avg).not.toBeNull();
    expect(avg).toBeGreaterThan(3500);
    expect(avg).toBeLessThan(3700);
  });
});
