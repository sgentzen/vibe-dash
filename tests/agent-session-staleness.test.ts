import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  startOrGetSession,
  closeStaleSession,
  cleanupStaleAgents,
} from "../server/db/index.js";
import { SESSION_TIMEOUT_MS } from "../server/constants.js";
import { NON_INSTANT_SHAPES } from "./timestamp-shapes.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

const LONG_AGO = "2020-01-01T00:00:00.000Z";
const NOW = () => new Date().toISOString();
const AGO = (ms: number) => new Date(Date.now() - ms).toISOString();

/**
 * Five seconds either side of the timeout. Wide enough that the test cannot
 * lose a race with its own execution time, narrow enough that an off-by-one on
 * the cutoff — a stray minute, seconds read as milliseconds — moves a session
 * across the line and fails.
 */
const MARGIN_MS = 5_000;

function newAgent(name: string): string {
  return registerAgent(db, { name, model: null, capabilities: [] }).id;
}

/**
 * Insert an open session row directly, so started_at and last_activity_at can
 * be set independently. The public API keeps them in step on the first write,
 * which is exactly what hid the disagreement these tests pin.
 */
function openSession(agentId: string, startedAt: string, lastActivityAt: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_id, started_at, ended_at, last_activity_at, tasks_touched, activity_count)
     VALUES (?, ?, ?, NULL, ?, 0, 1)`
  ).run(id, agentId, startedAt, lastActivityAt);
  return id;
}

function endedAtOf(sessionId: string): string | null {
  return (db.prepare("SELECT ended_at FROM agent_sessions WHERE id = ?").get(sessionId) as {
    ended_at: string | null;
  }).ended_at;
}

/**
 * Housekeeping decided staleness on `started_at` while `startOrGetSession`
 * decided it on `last_activity_at`. The two therefore answered the same
 * question differently: a session busy all afternoon was closed by the next
 * connect simply because it began more than the timeout ago, and a session
 * that began a minute ago but has been silent ever since was left open.
 * Session age is not what the timeout measures — idleness is.
 */
describe("closeStaleSession measures idleness, not session age", () => {
  it("leaves a long-running session open while it is still active", () => {
    const sessionId = openSession(newAgent("marathon"), LONG_AGO, NOW());

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
  });

  it("closes a session that has gone quiet even though it started just now", () => {
    const sessionId = openSession(newAgent("clocked-off"), NOW(), LONG_AGO);

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("closes a session that both started and fell quiet before the cutoff", () => {
    const sessionId = openSession(newAgent("gone"), LONG_AGO, LONG_AGO);

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("leaves a session that started and was active just now open", () => {
    const sessionId = openSession(newAgent("busy"), NOW(), NOW());

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
  });

  it("closes only the sessions startOrGetSession would refuse to reuse", () => {
    // The property that matters: housekeeping and the reuse check have to
    // agree. Whatever closeStaleSession leaves open, the next tool call must
    // still be able to pick up, and whatever it closes must be a session that
    // call would have abandoned anyway.
    const activeAgent = newAgent("still-here");
    const activeSession = openSession(activeAgent, LONG_AGO, NOW());
    const idleAgent = newAgent("walked-away");
    const idleSession = openSession(idleAgent, LONG_AGO, LONG_AGO);

    closeStaleSession(db);

    expect(startOrGetSession(db, activeAgent).id).toBe(activeSession);
    expect(endedAtOf(activeSession)).toBeNull();
    expect(startOrGetSession(db, idleAgent).id).not.toBe(idleSession);
  });

  it("sorts a mixed batch of open sessions in a single sweep", () => {
    // Housekeeping is one bulk UPDATE over every agent at once, but the cases
    // above each look at a session on its own. A batch is where an AND that
    // should be an OR shows up: the wrong operator still gets each individual
    // case right often enough to pass them.
    const survivors = [
      openSession(newAgent("busy-a"), NOW(), NOW()),
      openSession(newAgent("busy-b"), LONG_AGO, NOW()),
    ];
    const closed = [
      openSession(newAgent("quiet-a"), LONG_AGO, LONG_AGO),
      openSession(newAgent("quiet-b"), NOW(), LONG_AGO),
      openSession(newAgent("unreadable"), NOW(), "not-a-date"),
    ];

    expect(closeStaleSession(db)).toBe(closed.length);

    survivors.forEach((id) => expect(endedAtOf(id)).toBeNull());
    closed.forEach((id) => expect(endedAtOf(id)).not.toBeNull());
  });

  it("leaves an already-closed session's ended_at alone", () => {
    // `WHERE ended_at IS NULL` is what stops a second pass from rewriting the
    // close time of a session that ended hours ago, which would make every
    // closed session look like it ran until the last housekeeping sweep.
    const agentId = newAgent("long-gone");
    const sessionId = openSession(agentId, LONG_AGO, LONG_AGO);
    db.prepare("UPDATE agent_sessions SET ended_at = ? WHERE id = ?").run(LONG_AGO, sessionId);

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBe(LONG_AGO);
  });
});

/**
 * Both sides of the timeout, on the same column, in the same units.
 *
 * closeStaleSession compares julianday(last_activity_at) against a SQL cutoff
 * while startOrGetSession compares `Date.now() - lastActivity` in JavaScript
 * milliseconds. Two different clocks and two different units deciding one
 * question, so the line they draw is worth pinning rather than assuming.
 */
describe("closeStaleSession and startOrGetSession draw the cutoff in the same place", () => {
  it("leaves a session open just inside the timeout, and reuses it", () => {
    const agentId = newAgent("just-inside");
    const sessionId = openSession(agentId, LONG_AGO, AGO(SESSION_TIMEOUT_MS - MARGIN_MS));

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
    expect(startOrGetSession(db, agentId).id).toBe(sessionId);
  });

  it("closes a session just outside the timeout, and refuses to reuse it", () => {
    const agentId = newAgent("just-outside");
    const sessionId = openSession(agentId, NOW(), AGO(SESSION_TIMEOUT_MS + MARGIN_MS));

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
    expect(startOrGetSession(db, agentId).id).not.toBe(sessionId);
  });
});

/**
 * The fail-closed handling of a timestamp SQLite cannot parse has to survive
 * the move from started_at to last_activity_at. julianday() is NULL for
 * anything it cannot read, and a session whose idleness cannot be measured is
 * not one we can call live.
 */
describe("closeStaleSession still fails closed on an unreadable last_activity_at", () => {
  it("closes a session whose last_activity_at is blank", () => {
    const sessionId = openSession(newAgent("blank"), NOW(), "");

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("closes a session whose last_activity_at is not a date at all", () => {
    const sessionId = openSession(newAgent("garbage"), NOW(), "not-a-date");

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });
});

/**
 * The invariant that makes a connection's cached agent id safe.
 *
 * `createMcpServer` caches the agent id from `oninitialized` and reuses it on
 * every later tool call. That is only sound while the agent row cannot be
 * deleted underneath the connection. It cannot: the hook opens a session for
 * the agent, nothing anywhere deletes a row from `agent_sessions`, and the
 * foreign key on `agent_sessions.agent_id` refuses the delete for as long as
 * that row exists — whether it is open or was closed by the same housekeeping
 * pass moments earlier.
 *
 * Pinned rather than assumed, because the day something starts pruning
 * `agent_sessions` (or the foreign key gains ON DELETE CASCADE), the cached id
 * becomes a dangling reference and every tool call on that connection starts
 * failing. This test is where that shows up.
 */
describe("an idle connection's agent survives the housekeeping pass", () => {
  function idleConnection(): string {
    const agentId = newAgent("idle-client");
    startOrGetSession(db, agentId);
    db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(LONG_AGO, agentId);
    db.prepare("UPDATE agent_sessions SET started_at = ?, last_activity_at = ? WHERE agent_id = ?")
      .run(LONG_AGO, LONG_AGO, agentId);
    return agentId;
  }

  it("keeps the agent row a still-open connection is holding an id for", () => {
    const agentId = idleConnection();

    closeStaleSession(db);
    expect(cleanupStaleAgents(db)).toBe(0);

    expect(db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agentId)).not.toBeUndefined();
  });

  it("lets the next tool call open a fresh session on the cached id", () => {
    const agentId = idleConnection();

    closeStaleSession(db);
    cleanupStaleAgents(db);

    const session = startOrGetSession(db, agentId);
    expect(session.agent_id).toBe(agentId);
    expect(session.ended_at).toBeNull();
  });
});

/**
 * The timeout is a window, not a floor.
 *
 * Both checks read `last_activity_at` now, which is the right column but
 * concentrates the risk: one bad value defeats housekeeping and the reuse
 * check at once, where a bad `started_at` used to defeat only housekeeping. A
 * value dated ahead of the present satisfies both — `closeStaleSession` never
 * reaps the row and `startOrGetSession` keeps handing it back — so the session
 * stays open forever and its span keeps inflating the agent's
 * `activity_frequency`.
 *
 * Nothing user-controlled reaches the column: `startOrGetSession` binds
 * `now()` and migration 023 copies `started_at`. The realistic source is clock
 * skew between the server, the stdio MCP and the CLI, which VIBE_DASH_DB is
 * documented as letting share one database. So the bound tolerates ordinary
 * skew and rejects only what skew cannot explain: the far side is
 * SESSION_TIMEOUT_MS ahead, the same distance the past side already uses.
 */
describe("closeStaleSession bounds the future as well as the past", () => {
  const AHEAD = (ms: number) => new Date(Date.now() + ms).toISOString();

  it("leaves a session open when it is dated ahead by less than the timeout", () => {
    const agentId = newAgent("skewed-clock");
    const sessionId = openSession(agentId, NOW(), AHEAD(SESSION_TIMEOUT_MS - MARGIN_MS));

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
    expect(startOrGetSession(db, agentId).id).toBe(sessionId);
  });

  it("closes a session dated further ahead than the timeout", () => {
    const agentId = newAgent("from-the-future");
    const sessionId = openSession(agentId, NOW(), AHEAD(SESSION_TIMEOUT_MS + MARGIN_MS));

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
    expect(startOrGetSession(db, agentId).id).not.toBe(sessionId);
  });

  it("closes a session dated years ahead", () => {
    // The shape the review described: a value far enough ahead that no cutoff
    // built from the present will ever overtake it.
    const agentId = newAgent("never-stale");
    const sessionId = openSession(agentId, NOW(), "2099-01-01T00:00:00.000Z");

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
    expect(startOrGetSession(db, agentId).id).not.toBe(sessionId);
  });

  it("does not reap a session merely because it was active a moment ago", () => {
    // Guards the bound against being drawn at the present instant. The two
    // writers stamp `now()` and are read back microseconds later by a
    // different process; a zero-tolerance future bound would churn them.
    const agentId = newAgent("just-wrote");
    const sessionId = openSession(agentId, NOW(), AHEAD(50));

    expect(closeStaleSession(db)).toBe(0);
    expect(startOrGetSession(db, agentId).id).toBe(sessionId);
  });
});

/**
 * `julianday()` and `new Date()` both read more than the ISO instants `now()`
 * writes, and they do not read the same set.
 *
 * `julianday('now')` is not a stored moment — it re-evaluates to the current
 * instant on every pass, so a row literally carrying `'now'` is never older
 * than any cutoff and never further ahead than any horizon. No bound can catch
 * it, because it moves with the clock the bounds are built from. Other forms
 * are worse than unreadable, they are ambiguous: SQLite reads a date-time with
 * no zone as UTC and ECMAScript reads it as local, so the two checks disagree
 * about which instant the row names and one calls it live while the other
 * calls it stale. That is the split this whole change exists to close.
 *
 * So the guard is not a bound but a shape check, applied on both sides: the
 * column has to hold the exact instant `now()` produces, and anything else is
 * a value whose idleness cannot be measured — which the existing fail-closed
 * rule already says to treat as stale. Matching the writer exactly, rather
 * than surveying what the two parsers happen to tolerate, is what keeps the
 * sides from drifting apart again when either parser changes.
 */
describe("closeStaleSession treats a relative or ambiguous timestamp as unreadable", () => {
  const shapes = NON_INSTANT_SHAPES;

  it.each(shapes)("closes a session whose last_activity_at is %s", (_name, value) => {
    const sessionId = openSession(newAgent(`close-${_name}`), NOW(), value);

    expect(closeStaleSession(db)).toBe(1);
    expect(endedAtOf(sessionId)).not.toBeNull();
  });

  it("still accepts the ISO instant now() actually writes", () => {
    // The shape check has to admit the only format the two writers produce,
    // or housekeeping closes every live session on the next pass.
    const agentId = newAgent("well-formed");
    const sessionId = startOrGetSession(db, agentId).id;

    expect(closeStaleSession(db)).toBe(0);
    expect(endedAtOf(sessionId)).toBeNull();
  });

  /**
   * Each case gets its own row, and `closeStaleSession` is never called first.
   *
   * Asserting reuse on a row housekeeping has already closed proves nothing:
   * `startOrGetSession` skips a closed row whatever it thinks of the
   * timestamp, so the assertion passes even if the two disagree completely.
   * The disagreement only shows on a row housekeeping has not touched — which
   * is also the real case, since housekeeping runs on connect and the reuse
   * check runs on every tool call after it.
   */
  it.each(shapes)("refuses to reuse a session whose last_activity_at is %s", (_name, value) => {
    const agentId = newAgent(`reuse-${_name}`);
    const sessionId = openSession(agentId, NOW(), value);

    expect(startOrGetSession(db, agentId).id).not.toBe(sessionId);
  });
});
