import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createProject,
  createSprint,
  createTask,
  registerAgent,
  logCost,
  getAgentCostSummary,
  getSprintCostSummary,
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

  it("aggregates costs per sprint", () => {
    const project = createProject(db, { name: "P", description: null });
    const sprint = createSprint(db, { project_id: project.id, name: "S1" });

    logCost(db, { sprint_id: sprint.id, model: "gpt-4", provider: "openai", input_tokens: 200, output_tokens: 100, cost_usd: 0.01 });
    logCost(db, { sprint_id: sprint.id, model: "gpt-4", provider: "openai", input_tokens: 300, output_tokens: 150, cost_usd: 0.02 });

    const summary = getSprintCostSummary(db, sprint.id);
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
    expect(ts.length).toBeGreaterThanOrEqual(1);
    expect(ts[0].total_cost_usd).toBe(0.03);
    expect(ts[0].entry_count).toBe(2);
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
