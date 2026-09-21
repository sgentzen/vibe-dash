import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  countActiveAgents,
  getAgentHealthStatus,
  ACTIVE_THRESHOLD_MS,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => {
  db = createTestDb();
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** An agent whose last_seen_at is forced to `lastSeenAt`, written as the value would sit on disk. */
function agentSeen(name: string, lastSeenAt: string): string {
  const id = registerAgent(db, { name, model: null, capabilities: [] }).id;
  db.prepare("UPDATE agents SET last_seen_at = ? WHERE id = ?").run(lastSeenAt, id);
  return id;
}

/**
 * The /api/stats activeAgents figure compared last_seen_at (ISO, 'T' and 'Z')
 * as a raw string against datetime('now', '-5 minutes') (space, no zone). The
 * two formats first differ at offset 10, where 'T' (0x54) outranks ' ' (0x20),
 * so any agent last seen on the current UTC date compared greater than the
 * cutoff whatever the time of day. "Active in the last 5 minutes" was in
 * practice "seen today (UTC)": an agent last seen 1 hour ago was counted, one
 * from 6 hours ago (previous UTC date) was not, and the per-agent badge from
 * getAgentHealthStatus disagreed with both.
 *
 */
describe("countActiveAgents window", () => {
  it("counts an agent seen 1 minute ago", () => {
    agentSeen("fresh", ago(MINUTE));
    expect(countActiveAgents(db)).toBe(1);
  });

  it("does not count an agent seen 1 hour ago", () => {
    agentSeen("hour-old", ago(HOUR));
    expect(countActiveAgents(db)).toBe(0);
  });

  it("does not count an agent seen 6 hours ago", () => {
    agentSeen("six-hours", ago(6 * HOUR));
    expect(countActiveAgents(db)).toBe(0);
  });

  it("does not count an agent just outside the threshold", () => {
    agentSeen("stale", ago(ACTIVE_THRESHOLD_MS + MINUTE));
    expect(countActiveAgents(db)).toBe(0);
  });

  it("counts an agent just inside the threshold", () => {
    agentSeen("recent", ago(ACTIVE_THRESHOLD_MS - MINUTE));
    expect(countActiveAgents(db)).toBe(1);
  });

  it("does not count sub-agents", () => {
    const parent = agentSeen("parent", ago(MINUTE));
    const child = agentSeen("child", ago(MINUTE));
    db.prepare("UPDATE agents SET parent_agent_id = ? WHERE id = ?").run(parent, child);
    expect(countActiveAgents(db)).toBe(1);
  });

  it("agrees with the per-agent health badge", () => {
    const offsets = [0, MINUTE, ACTIVE_THRESHOLD_MS - MINUTE, ACTIVE_THRESHOLD_MS + MINUTE, HOUR, 6 * HOUR, 48 * HOUR];
    const seen = offsets.map((o, i) => {
      const ts = ago(o);
      agentSeen(`agent-${i}`, ts);
      return ts;
    });
    const badged = seen.filter((ts) => getAgentHealthStatus(ts) === "active").length;
    expect(countActiveAgents(db)).toBe(badged);
  });
});

/**
 * `'not-a-date' >= <cutoff>` is true because letters outrank digits, so an
 * agent whose last_seen_at could not be read counted as active on every poll,
 * forever. getAgentHealthStatus already answers "offline" for the same value
 * (NaN elapsed fails every threshold); the count now agrees. A blank value
 * sorted below the cutoff and was excluded, so the two unreadable shapes used
 * to pull in opposite directions.
 */
describe("countActiveAgents with unreadable last_seen_at", () => {
  it.each([
    ["a non-date string", "not-a-date"],
    ["a blank string", ""],
    ["the literal 'now'", "now"],
  ])("does not count an agent whose last_seen_at is %s", (_label, value) => {
    agentSeen("corrupt", value);
    expect(countActiveAgents(db)).toBe(0);
  });

  it("still counts the readable agent beside an unreadable one", () => {
    agentSeen("corrupt", "not-a-date");
    agentSeen("fresh", ago(MINUTE));
    expect(countActiveAgents(db)).toBe(1);
  });
});
