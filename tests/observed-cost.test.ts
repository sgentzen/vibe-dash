import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent, getAgentById, setAgentCostObserved,
  logCost, createProject, createMilestone,
  getGlobalCostSummary, getProjectCostSummary, getAgentCostSummary,
  getMilestoneCostSummary, getSpendToday, getCostByModel, getCostByAgent,
  getCostTimeseries,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("agents.cost_observed_externally", () => {
  it("defaults to 0 so an upgrade changes no existing total", () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("marks and unmarks an agent", () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    const marked = setAgentCostObserved(db, agent.id, true);
    expect(marked!.cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);

    const unmarked = setAgentCostObserved(db, agent.id, false);
    expect(unmarked!.cost_observed_externally).toBe(0);
  });

  it("returns null for an agent that does not exist", () => {
    expect(setAgentCostObserved(db, "no-such-agent", true)).toBeNull();
  });
});

describe("excluding an observed agent's self-reported cost", () => {
  const seed = (db: Database.Database) => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    // The duplicate: this agent self-reported, and we also read its transcript.
    logCost(db, {
      agent_id: agent.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 10, output_tokens: 10, cost_usd: 5,
    });
    // The observation. Transcript rows carry no agent.
    db.prepare(
      `INSERT INTO cost_entries (id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('t1', ?, 'claude-opus-5', 'anthropic', 10, 10, 5, ?, 'transcript', 'uuid-1')`
    ).run(project.id, new Date().toISOString());

    return { project, agent };
  };

  it("halves a doubled global total once the agent is marked", () => {
    const { agent } = seed(db);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);

    setAgentCostObserved(db, agent.id, true);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(5, 10);
  });

  it("restores the previous total when the agent is unmarked", () => {
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);
    setAgentCostObserved(db, agent.id, false);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);
  });

  it("keeps the transcript row, dropping only the self-report", () => {
    const { project, agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);

    const summary = getProjectCostSummary(db, project.id);
    expect(summary.total_cost_usd).toBeCloseTo(5, 10);
    expect(summary.entry_count).toBe(1);
  });

  it("applies to spend-today, by-model, by-agent and the timeseries", () => {
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);

    expect(getSpendToday(db)).toBeCloseTo(5, 10);

    const byModel = getCostByModel(db);
    expect(byModel).toHaveLength(1);
    expect(byModel[0].total_cost_usd).toBeCloseTo(5, 10);

    // The only agent-attributed row was the excluded one, so the breakdown empties.
    expect(getCostByAgent(db)).toHaveLength(0);

    const total = getCostTimeseries(db).reduce((sum, d) => sum + d.total_cost_usd, 0);
    expect(total).toBeCloseTo(5, 10);
  });

  it("applies to the milestone summary too, covering every exported total", () => {
    // getAgentCostSummary, getProjectCostSummary and getMilestoneCostSummary all
    // route through getCostSummaryBy, but the spec's risk table promises every
    // exported cost function is covered, so name this one explicitly rather
    // than leaving it implied by a shared code path.
    const project = createProject(db, { name: "m-demo", description: null });
    // Every field but project_id and name is optional on CreateMilestoneInput.
    const milestone = createMilestone(db, { project_id: project.id, name: "m1" });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    logCost(db, {
      agent_id: agent.id, project_id: project.id, milestone_id: milestone.id,
      model: "claude-opus-5", provider: "anthropic",
      input_tokens: 1, output_tokens: 1, cost_usd: 7,
    });

    expect(getMilestoneCostSummary(db, milestone.id).total_cost_usd).toBeCloseTo(7, 10);
    setAgentCostObserved(db, agent.id, true);
    expect(getMilestoneCostSummary(db, milestone.id).total_cost_usd).toBeCloseTo(0, 10);
  });

  it("reads zero for a marked agent's own summary, deliberately", () => {
    // Its self-reports are duplicates, and the observation that replaced them
    // carries no agent, so there is nothing left to attribute to it. Surprising
    // enough to be worth pinning down rather than discovering later.
    const { agent } = seed(db);
    setAgentCostObserved(db, agent.id, true);
    expect(getAgentCostSummary(db, agent.id).total_cost_usd).toBeCloseTo(0, 10);
  });

  it("never excludes a row with no agent, marked or not", () => {
    const project = createProject(db, { name: "orphan", description: null });
    logCost(db, {
      agent_id: null, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 3,
    });

    // Before any agent is marked, the row is naturally uncontested.
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(3, 10);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(3, 10);

    // This is the shape that actually triggers the trap: a DIFFERENT agent —
    // one the NULL-agent row has no relationship to — gets marked observed.
    // `agent_id IN (<non-empty subquery>)` now evaluates to NULL rather than
    // FALSE for the NULL-agent row, so without the `agent_id IS NOT NULL`
    // guard, `NOT (... AND NULL)` is NULL, and a WHERE clause silently drops
    // the row. The row must survive unchanged: it cannot be excluded by
    // agent because it names none.
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    setAgentCostObserved(db, agent.id, true);

    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(3, 10);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(3, 10);
  });

  it("does not exclude an unmarked agent's rows", () => {
    const { agent } = seed(db);
    const other = registerAgent(db, { name: "cursor-bot", model: "claude-opus-5", capabilities: [] });
    setAgentCostObserved(db, other.id, true);
    void agent;

    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(10, 10);
  });
});
