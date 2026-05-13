import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createMilestone,
  createTask,
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
    expect(entry.cost_usd).toBe(0.045);

    const summary = getAgentCostSummary(db, agent.id);
    expect(summary.total_cost_usd).toBe(0.045);
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
    expect(summary.total_cost_usd).toBe(0.03);
    expect(summary.total_input_tokens).toBe(500);
    expect(summary.entry_count).toBe(2);
  });

  it("aggregates costs per project", () => {
    const project = createProject(db, { name: "P", description: null });

    logCost(db, { project_id: project.id, model: "claude-sonnet-4-6", provider: "anthropic", input_tokens: 500, output_tokens: 250, cost_usd: 0.005 });

    const summary = getProjectCostSummary(db, project.id);
    expect(summary.total_cost_usd).toBe(0.005);
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
    expect(todays.total_cost_usd).toBe(0.03);
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
    expect(backdatedRow.total_cost_usd).toBe(0.07);
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
    expect(byAgent[0].total_cost_usd).toBe(0.03);
  });

  it("returns zero summary for unknown agent", () => {
    const summary = getAgentCostSummary(db, "nonexistent-id");
    expect(summary.total_cost_usd).toBe(0);
    expect(summary.entry_count).toBe(0);
  });
});
