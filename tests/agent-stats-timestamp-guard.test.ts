import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { NON_INSTANT_SHAPES } from "./timestamp-shapes.js";
import { registerAgent, getAgentStats } from "../server/db/index.js";
import { SESSION_TIMEOUT_MS } from "../server/constants.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

const HOUR_MS = 3_600_000;
const NOW = () => new Date().toISOString();
const AGO = (ms: number) => new Date(Date.now() - ms).toISOString();
const AHEAD = (ms: number) => new Date(Date.now() + ms).toISOString();
const FAR_FUTURE = "2099-01-01T00:00:00.000Z";
const MARGIN_MS = 5_000;

function newAgent(name: string): string {
  return registerAgent(db, { name, model: null, capabilities: [] }).id;
}

/** Insert a session row directly so each timestamp column can be set alone. */
function session(
  agentId: string,
  o: { startedAt: string; lastActivityAt: string; endedAt?: string | null; activityCount: number }
): void {
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_id, started_at, ended_at, last_activity_at, tasks_touched, activity_count)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(randomUUID(), agentId, o.startedAt, o.endedAt ?? null, o.lastActivityAt, o.activityCount);
}

const frequency = (agentId: string) => getAgentStats(db, agentId).activity_frequency;

/**
 * A real session: ten activities over one hour, so the rate is 10/hr. Every
 * case adds one bad session beside it, which is what makes a leak visible: an
 * unguarded row either dilutes the hours (future span) or inflates the count
 * (span clamped to 0.01h), and the rate moves off 10.
 *
 * None of these calls closeStaleSession first, on purpose. Housekeeping closes
 * a bad open row by setting ended_at to now(), which makes the span readable
 * and the row pass any gate, so asserting after a sweep proves nothing. The
 * window these tests cover is the one before housekeeping runs, which is
 * also the real one: stats are read on every dashboard request.
 */
function agentWithOneRealHour(name: string): string {
  const agentId = newAgent(name);
  session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: NOW(), activityCount: 10 });
  return agentId;
}

describe("getAgentStats drops a session whose span end is not a usable instant", () => {
  it("reports the baseline rate for the one real session", () => {
    expect(frequency(agentWithOneRealHour("baseline"))).toBe(10);
  });

  it.each(NON_INSTANT_SHAPES)("ignores an open session whose last_activity_at is %s", (name, value) => {
    const agentId = agentWithOneRealHour(`open-${name}`);
    session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: value, activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores an open session dated years ahead", () => {
    const agentId = agentWithOneRealHour("years-ahead");
    session(agentId, { startedAt: NOW(), lastActivityAt: FAR_FUTURE, activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores an open session dated further ahead than the timeout", () => {
    const agentId = agentWithOneRealHour("beyond-skew");
    session(agentId, {
      startedAt: NOW(),
      lastActivityAt: AHEAD(SESSION_TIMEOUT_MS + MARGIN_MS),
      activityCount: 500,
    });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores a closed session whose ended_at is dated in the future", () => {
    const agentId = agentWithOneRealHour("closed-future");
    session(agentId, { startedAt: NOW(), lastActivityAt: NOW(), endedAt: FAR_FUTURE, activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores a closed session whose ended_at is 'now'", () => {
    const agentId = agentWithOneRealHour("closed-now");
    session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: NOW(), endedAt: "now", activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it.each(NON_INSTANT_SHAPES)("ignores a closed session whose ended_at is %s", (name, value) => {
    const agentId = agentWithOneRealHour(`ended-${name}`);
    session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: NOW(), endedAt: value, activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it.each(NON_INSTANT_SHAPES)("ignores a session whose started_at is %s", (name, value) => {
    // started_at is the subtrahend. A value at or past the end makes the span
    // negative, MAX() clamps it to 0.01h, and 500 activities over 0.01h is a
    // fabricated 50000/hr: the same hole from the other end.
    const agentId = agentWithOneRealHour(`start-${name}`);
    session(agentId, { startedAt: value, lastActivityAt: NOW(), activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores a session whose started_at is dated further ahead than the timeout", () => {
    const agentId = agentWithOneRealHour("start-beyond-skew");
    session(agentId, {
      startedAt: AHEAD(SESSION_TIMEOUT_MS + MARGIN_MS),
      lastActivityAt: NOW(),
      activityCount: 500,
    });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores a closed session whose ended_at is further ahead than the timeout", () => {
    const agentId = agentWithOneRealHour("ended-beyond-skew");
    session(agentId, {
      startedAt: NOW(),
      lastActivityAt: NOW(),
      endedAt: AHEAD(SESSION_TIMEOUT_MS + MARGIN_MS),
      activityCount: 500,
    });

    expect(frequency(agentId)).toBe(10);
  });

  it("reports no rate at all when the only session is unmeasurable", () => {
    const agentId = newAgent("only-bad");
    session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: "now", activityCount: 500 });

    expect(frequency(agentId)).toBe(0);
  });
});

describe("getAgentStats still counts sessions the gate has no quarrel with", () => {
  it("counts an open session dated ahead by ordinary skew", () => {
    const agentId = newAgent("skewed-clock");
    session(agentId, { startedAt: AGO(HOUR_MS), lastActivityAt: AHEAD(50), activityCount: 12 });

    expect(frequency(agentId)).toBe(12);
  });

  it("counts a closed session whose last_activity_at is unreadable", () => {
    // ended_at is the span end once it is set, so last_activity_at is never
    // consulted. Gating on it regardless would silently drop real history.
    const agentId = newAgent("closed-and-tidy");
    session(agentId, {
      startedAt: AGO(2 * HOUR_MS),
      lastActivityAt: "not-a-date",
      endedAt: AGO(HOUR_MS),
      activityCount: 10,
    });

    expect(frequency(agentId)).toBe(10);
  });

  it("counts a closed session with a valid ended_at whatever its last_activity_at says", () => {
    const agentId = newAgent("closed-future-activity");
    session(agentId, {
      startedAt: AGO(2 * HOUR_MS),
      lastActivityAt: FAR_FUTURE,
      endedAt: AGO(HOUR_MS),
      activityCount: 10,
    });

    expect(frequency(agentId)).toBe(10);
  });

  it("ignores a session whose last_activity_at runs behind its started_at", () => {
    // Both instants are well formed and inside the window, so neither bound nor
    // the shape check objects to either one. Only their order is wrong, which is
    // what a slow clock in a second process produces.
    const agentId = agentWithOneRealHour("backwards");
    session(agentId, { startedAt: NOW(), lastActivityAt: AGO(HOUR_MS), activityCount: 500 });

    expect(frequency(agentId)).toBe(10);
  });

  it("still counts a zero-length session", () => {
    // startOrGetSession writes both columns from one now(), so this is the
    // normal state of a session's first activity.
    const agentId = newAgent("fresh");
    const ts = NOW();
    session(agentId, { startedAt: ts, lastActivityAt: ts, activityCount: 1 });

    expect(frequency(agentId)).toBe(100);
  });
});

