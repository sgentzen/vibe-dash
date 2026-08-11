import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  setAgentCostObserved,
  getAgentCostSummary,
  getCostByAgent,
  getGlobalCostSummary,
  createProject,
  createMilestone,
  getMilestoneCostSummary,
  getProjectCostSummary,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function addMcpCost(db: Database.Database, id: string, agentId: string, cost: number): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, ?, NULL, 'claude-opus-5', 'anthropic', 10, 10, ?, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
  ).run(id, agentId, cost);
}

describe("excluded_entries", () => {
  it("is zero when nothing is marked", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(5);
    expect(summary.excluded_entries).toBe(0);
  });

  it("reports definite zeroes for an agent with no cost rows at all", () => {
    // Conditional aggregation replaced COUNT(*) with SUM(CASE ...), and SUM
    // over zero rows is NULL where COUNT(*) was 0. This query has no GROUP BY,
    // so an empty scope still returns one row and every count must be COALESCEd
    // or the API reports null for a field typed as a number.
    const agent = registerAgent(db, { name: "idle", model: null, capabilities: [] });

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
    expect(summary.unpriced_entries).toBe(0);
    expect(summary.excluded_entries).toBe(0);
  });

  it("counts the suppressed rows once the client is marked", () => {
    // The total honestly drops to 0, and excluded_entries is what stops that
    // reading as "this agent cost nothing".
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    addMcpCost(db, "m2", agent.id, 7);
    setAgentCostObserved(db, agent.id, true);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
    expect(summary.excluded_entries).toBe(2);
  });

  it("keeps a fully suppressed agent in the by-agent breakdown", () => {
    // Before this, GROUP BY produced no group at all and the agent vanished
    // from the list, which reads as "never spent anything".
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    setAgentCostObserved(db, agent.id, true);

    const row = getCostByAgent(db).find((r) => r.agent_id === agent.id);
    expect(row).toBeDefined();
    expect(row!.total_cost_usd).toBe(0);
    expect(row!.entry_count).toBe(0);
    expect(row!.excluded_entries).toBe(1);
  });

  it("leaves an unmarked agent's row untouched", () => {
    const marked = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    const other = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });
    addMcpCost(db, "m1", marked.id, 5);
    addMcpCost(db, "m2", other.id, 3);
    setAgentCostObserved(db, marked.id, true);

    const row = getCostByAgent(db).find((r) => r.agent_id === other.id);
    expect(row!.total_cost_usd).toBe(3);
    expect(row!.entry_count).toBe(1);
    expect(row!.excluded_entries).toBe(0);
  });

  it("does not change the global total's shape", () => {
    // Global scope keeps filtering in WHERE: the suppressed rows are simply not
    // part of that answer.
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    addMcpCost(db, "m1", agent.id, 5);
    setAgentCostObserved(db, agent.id, true);

    expect(getGlobalCostSummary(db).total_cost_usd).toBe(0);
  });

  it("suppresses a reconnected agent sharing the marked client identity", () => {
    // The mark keys to client_name, not the agent row, so a client that
    // reconnects under a fresh agent id — a new MCP connection registers a new
    // agent — must still be suppressed via the conditional-aggregation path,
    // not just the row that was directly marked.
    const first = registerAgent(db, {
      name: "claude-session-1",
      model: null,
      capabilities: [],
      client_name: "claude-code",
    });
    setAgentCostObserved(db, first.id, true);

    const second = registerAgent(db, {
      name: "claude-session-2",
      model: null,
      capabilities: [],
      client_name: "claude-code",
    });
    addMcpCost(db, "m1", second.id, 9);

    const summary = getAgentCostSummary(db, second.id);
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.excluded_entries).toBe(1);
  });

  it("reports excluded_entries for the milestone and project scopes too", () => {
    // getMilestoneCostSummary and getProjectCostSummary delegate to the same
    // rewritten getCostSummaryBy as getAgentCostSummary. Pin excluded_entries
    // on both, not just total_cost_usd, so a future per-column regression in
    // the shared query can't hide behind a test that only checks the total.
    const project = createProject(db, { name: "demo", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "m1" });
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, milestone_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m1', ?, ?, ?, 'claude-opus-5', 'anthropic', 10, 10, 5, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(agent.id, project.id, milestone.id);
    setAgentCostObserved(db, agent.id, true);

    const milestoneSummary = getMilestoneCostSummary(db, milestone.id);
    expect(milestoneSummary.total_cost_usd).toBe(0);
    expect(milestoneSummary.excluded_entries).toBe(1);

    const projectSummary = getProjectCostSummary(db, project.id);
    expect(projectSummary.total_cost_usd).toBe(0);
    expect(projectSummary.excluded_entries).toBe(1);
  });

  it("scopes excluded_entries to the filtered project in getCostByAgent", () => {
    // The call site the code comments call out as most likely to diverge: it
    // joins agents, groups by c.agent_id, and applies an optional
    // project_id/milestone_id filter alongside the exclusion. Prove the
    // filter and the exclusion compose instead of one silently overriding
    // the other.
    const projectA = createProject(db, { name: "a", description: null });
    const projectB = createProject(db, { name: "b", description: null });
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    setAgentCostObserved(db, agent.id, true);

    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m1', ?, ?, 'claude-opus-5', 'anthropic', 10, 10, 5, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(agent.id, projectA.id);
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m2', ?, ?, 'claude-opus-5', 'anthropic', 10, 10, 5, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(agent.id, projectB.id);

    const rowsA = getCostByAgent(db, { project_id: projectA.id });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].total_cost_usd).toBe(0);
    expect(rowsA[0].excluded_entries).toBe(1);
  });

  it("does not double-count a row that is both excluded and unpriced", () => {
    // A duplicate row with cost_usd NULL must count only toward
    // excluded_entries, not also toward unpriced_entries. unpriced_entries is
    // reserved for rows still part of the answer whose price is unknown; a
    // row that's excluded is not part of the answer at all, priced or not.
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m1', ?, NULL, 'claude-opus-5', 'anthropic', 10, 10, NULL, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(agent.id);
    setAgentCostObserved(db, agent.id, true);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.excluded_entries).toBe(1);
    expect(summary.unpriced_entries).toBe(0);
    expect(summary.entry_count).toBe(0);
  });
});
