import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createMilestone,
  registerAgent,
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
} from "../server/db/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("cost tracking", () => {
  it("logs a cost entry and retrieves it via agent summary", () => {
    const agent = registerAgent(db, { name: "cost-agent", model: "claude-opus-4-6", capabilities: [] });
    const entry = logCost(db, {
      agent_id: agent.id,
      model: "claude-opus-4-6",
      provider: "anthropic",
      input_tokens: 1000,
      output_tokens: 500,
      cost_usd: 0.045,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.model).toBe("claude-opus-4-6");
    expect(entry.input_tokens).toBe(1000);
    expect(entry.cost_usd).toBeCloseTo(0.045, 10);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBeCloseTo(0.045, 10);
    expect(summary.total_input_tokens).toBe(1000);
    expect(summary.total_output_tokens).toBe(500);
    expect(summary.entry_count).toBe(1);
  });

  it("aggregates costs per milestone", () => {
    const project = createProject(db, { name: "P", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "M1" });

    logCost(db, { milestone_id: milestone.id, model: "gpt-4", provider: "openai", input_tokens: 200, output_tokens: 100, cost_usd: 0.01 });
    logCost(db, { milestone_id: milestone.id, model: "gpt-4", provider: "openai", input_tokens: 300, output_tokens: 150, cost_usd: 0.02 });

    const summary = getMilestoneCostSummary(db, milestone.id);
    expect(summary.total_cost_usd).toBeCloseTo(0.03, 10);
    expect(summary.total_input_tokens).toBe(500);
    expect(summary.entry_count).toBe(2);
  });

  it("aggregates costs per project", () => {
    const project = createProject(db, { name: "P", description: null });

    logCost(db, { project_id: project.id, model: "claude-sonnet-4-6", provider: "anthropic", input_tokens: 500, output_tokens: 250, cost_usd: 0.005 });

    const summary = getProjectCostSummary(db, project.id);
    expect(summary.total_cost_usd).toBeCloseTo(0.005, 10);
    expect(summary.entry_count).toBe(1);
  });

  it("returns timeseries data", () => {
    const project = createProject(db, { name: "P", description: null });
    logCost(db, { project_id: project.id, model: "m1", provider: "p1", input_tokens: 100, output_tokens: 50, cost_usd: 0.01 });
    logCost(db, { project_id: project.id, model: "m1", provider: "p1", input_tokens: 200, output_tokens: 100, cost_usd: 0.02 });

    const ts = getCostTimeseries(db, { project_id: project.id, days: 7 });
    expect(ts).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    expect(ts[ts.length - 1].date).toBe(today);
    const todays = ts.find((r) => r.date === today)!;
    expect(todays.total_cost_usd).toBeCloseTo(0.03, 10);
    expect(todays.entry_count).toBe(2);
  });

  it("zero-fills days with no cost entries across the requested window", () => {
    const project = createProject(db, { name: "P", description: null });
    // Backdate a cost to 5 days ago (UTC)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, task_id, milestone_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, NULL, NULL, NULL, ?, 'm1', 'p1', 100, 50, 0.07, ?)`
    ).run("backdated-1", project.id, fiveDaysAgo);

    const ts = getCostTimeseries(db, { project_id: project.id, days: 7 });
    expect(ts).toHaveLength(7);

    const today = new Date().toISOString().slice(0, 10);
    expect(ts[ts.length - 1].date).toBe(today);
    expect(ts[ts.length - 1].total_cost_usd).toBe(0);
    expect(ts[ts.length - 1].entry_count).toBe(0);

    const backdatedDate = fiveDaysAgo.slice(0, 10);
    const backdatedRow = ts.find((r) => r.date === backdatedDate)!;
    expect(backdatedRow.total_cost_usd).toBeCloseTo(0.07, 10);
    expect(backdatedRow.entry_count).toBe(1);

    // Dates are strictly contiguous ascending
    for (let i = 1; i < ts.length; i++) {
      const prev = new Date(ts[i - 1].date + "T00:00:00Z").getTime();
      const cur = new Date(ts[i].date + "T00:00:00Z").getTime();
      expect(cur - prev).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("breaks down costs by model", () => {
    const project = createProject(db, { name: "P", description: null });
    logCost(db, { project_id: project.id, model: "claude-opus-4-6", provider: "anthropic", input_tokens: 1000, output_tokens: 500, cost_usd: 0.05 });
    logCost(db, { project_id: project.id, model: "gpt-4", provider: "openai", input_tokens: 500, output_tokens: 250, cost_usd: 0.02 });

    const byModel = getCostByModel(db, { project_id: project.id });
    expect(byModel).toHaveLength(2);
    expect(byModel[0].total_cost_usd).toBeGreaterThanOrEqual(byModel[1].total_cost_usd);
  });

  it("breaks down costs by agent", () => {
    const project = createProject(db, { name: "P", description: null });
    const a1 = registerAgent(db, { name: "agent-1", model: null, capabilities: [] });
    const a2 = registerAgent(db, { name: "agent-2", model: null, capabilities: [] });

    logCost(db, { project_id: project.id, agent_id: a1.id, model: "m1", provider: "p1", input_tokens: 100, output_tokens: 50, cost_usd: 0.01 });
    logCost(db, { project_id: project.id, agent_id: a2.id, model: "m1", provider: "p1", input_tokens: 200, output_tokens: 100, cost_usd: 0.03 });

    const byAgent = getCostByAgent(db, { project_id: project.id });
    expect(byAgent).toHaveLength(2);
    expect(byAgent[0].agent_name).toBe("agent-2");
    expect(byAgent[0].total_cost_usd).toBeCloseTo(0.03, 10);
  });

  it("returns zero summary for unknown agent", () => {
    const summary = getAgentCostSummary(db, "nonexistent-id");
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
  });
});

describe("unpriced rows", () => {
  // A model that is not in the rate table stores cost_usd NULL, never 0. That
  // is deliberate, but SQL SUM skips NULLs, so every aggregate has to say what
  // it did with those rows instead of quietly reporting NULL (which crashes the
  // dashboard) or a bare 0 (which reads as "this was free").
  const insertUnpriced = (id: string, projectId: string, createdAt: string = new Date().toISOString()): void => {
    db.prepare(
      `INSERT INTO cost_entries
         (id, agent_id, task_id, milestone_id, project_id, model, provider,
          input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, NULL, NULL, NULL, ?, 'claude-not-yet-released', 'anthropic',
               1000, 500, NULL, ?, 'transcript', ?)`
    ).run(id, projectId, createdAt, `ext-${id}`);
  };

  it("getCostByModel returns a number total when every row for a model is unpriced", () => {
    const project = createProject(db, { name: "P", description: null });
    insertUnpriced("u1", project.id);

    const byModel = getCostByModel(db, { project_id: project.id });
    expect(byModel).toHaveLength(1);
    // A null here reaches the UI as null.toFixed(4) and blanks the whole page.
    expect(typeof byModel[0].total_cost_usd).toBe("number");
    expect(byModel[0].total_cost_usd).toBe(0);
    expect(byModel[0].total_tokens).toBe(1500);
  });

  it("getCostTimeseries returns a number total for a day whose rows are all unpriced", () => {
    const project = createProject(db, { name: "P", description: null });
    insertUnpriced("u2", project.id);

    const ts = getCostTimeseries(db, { project_id: project.id, days: 7 });
    const today = ts[ts.length - 1];
    expect(typeof today.total_cost_usd).toBe("number");
    expect(today.total_cost_usd).toBe(0);
    expect(today.entry_count).toBe(1);
  });

  it("counts the unpriced rows behind each total", () => {
    const project = createProject(db, { name: "P", description: null });
    logCost(db, { project_id: project.id, model: "claude-not-yet-released", provider: "anthropic", input_tokens: 100, output_tokens: 50, cost_usd: 0.05 });
    insertUnpriced("u3", project.id);
    insertUnpriced("u4", project.id);

    const summary = getProjectCostSummary(db, project.id);
    expect(summary.entry_count).toBe(3);
    expect(summary.total_cost_usd).toBeCloseTo(0.05, 10);
    // Without this the $0.05 is indistinguishable from the whole truth.
    expect(summary.unpriced_entries).toBe(2);

    const byModel = getCostByModel(db, { project_id: project.id });
    expect(byModel).toHaveLength(1);
    expect(byModel[0].unpriced_entries).toBe(2);

    const ts = getCostTimeseries(db, { project_id: project.id, days: 7 });
    expect(ts[ts.length - 1].unpriced_entries).toBe(2);
  });

  it("reports zero unpriced entries when every row is priced", () => {
    const project = createProject(db, { name: "P", description: null });
    logCost(db, { project_id: project.id, model: "claude-opus-5", provider: "anthropic", input_tokens: 100, output_tokens: 50, cost_usd: 0.05 });

    expect(getProjectCostSummary(db, project.id).unpriced_entries).toBe(0);
    expect(getCostByModel(db, { project_id: project.id })[0].unpriced_entries).toBe(0);
  });

  it("counts unpriced rows in the per-agent breakdown too", () => {
    const project = createProject(db, { name: "P", description: null });
    const agent = registerAgent(db, { name: "unpriced-agent", model: null, capabilities: [] });
    logCost(db, { project_id: project.id, agent_id: agent.id, model: "m1", provider: "p1", input_tokens: 10, output_tokens: 5, cost_usd: 0.01 });
    insertUnpriced("u5", project.id);
    db.prepare(`UPDATE cost_entries SET agent_id = ? WHERE id = 'u5'`).run(agent.id);

    const byAgent = getCostByAgent(db, { project_id: project.id });
    expect(byAgent).toHaveLength(1);
    expect(typeof byAgent[0].total_cost_usd).toBe("number");
    expect(byAgent[0].unpriced_entries).toBe(1);
    expect(byAgent[0].entry_count).toBe(2);
  });
});
