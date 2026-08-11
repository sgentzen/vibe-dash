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

    // The agent stays in the breakdown even though its only row is suppressed —
    // it reads as excluded, not as an agent that never spent anything (Task 4).
    const byAgent = getCostByAgent(db);
    expect(byAgent).toHaveLength(1);
    expect(byAgent[0].total_cost_usd).toBeCloseTo(0, 10);
    expect(byAgent[0].entry_count).toBe(0);
    expect(byAgent[0].excluded_entries).toBe(1);

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

  it("excludes a later connection of a marked client", () => {
    // The mark must follow the client, not one session's agent row.
    const project = createProject(db, { name: "demo", description: null });
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);

    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    db.prepare(
      `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES ('m1', ?, ?, 'claude-opus-5', 'anthropic', 1, 1, 5, '2026-08-10T10:00:00.000Z', 'mcp', NULL)`
    ).run(tuesday.id, project.id);

    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBe(0);
    expect(getGlobalCostSummary(db).total_cost_usd).toBe(0);
  });
});

describe("excluding a later connection of a marked client, at every call site", () => {
  // The test above covers the project and global summaries. The remaining six
  // exported cost functions each build their own WHERE clause, so a re-key that
  // reached only some of them would still double count. This seed is the shape
  // the re-key exists for: the row a user marked is gone, its successor carries
  // the spend, and an unrelated client's spend must survive untouched.
  const seed = (db: Database.Database) => {
    const project = createProject(db, { name: "demo", description: null });
    const milestone = createMilestone(db, { project_id: project.id, name: "m1" });

    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);

    // Tuesday's connection: a different agent row, never marked itself.
    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    logCost(db, {
      agent_id: tuesday.id, project_id: project.id, milestone_id: milestone.id,
      model: "claude-opus-5", provider: "anthropic",
      input_tokens: 10, output_tokens: 10, cost_usd: 5,
    });

    // A different client, never marked. Deliberately on the same model,
    // milestone and project as the excluded row, so a query that dropped the
    // whole group rather than the one row reads 0 here instead of 3.
    const cursor = registerAgent(db, {
      name: "cursor-1234abcd", model: null, capabilities: [], client_name: "cursor",
    });
    logCost(db, {
      agent_id: cursor.id, project_id: project.id, milestone_id: milestone.id,
      model: "claude-opus-5", provider: "anthropic",
      input_tokens: 4, output_tokens: 4, cost_usd: 3,
    });

    return { project, milestone, tuesday, cursor };
  };

  it("keeps the reconnected client's duplicated spend out of the by-agent breakdown", () => {
    // The call site most likely to diverge: it is the only one that joins
    // `agents`, it groups by c.agent_id, and it carries its own explicit
    // `agent_id IS NOT NULL` guard alongside the exclusion.
    //
    // Asserted as money, not as row shape. Whether an agent whose every row is
    // excluded disappears from the breakdown or stays in it reading zero is a
    // separate decision about presentation; what must hold either way is that
    // none of its duplicated spend is counted.
    const { tuesday, cursor } = seed(db);

    const byAgent = getCostByAgent(db);
    expect(byAgent.find((r) => r.agent_id === tuesday.id)?.total_cost_usd ?? 0).toBeCloseTo(0, 10);
    expect(byAgent.find((r) => r.agent_id === cursor.id)!.total_cost_usd).toBeCloseTo(3, 10);
  });

  it("applies to spend-today, by-model and the timeseries", () => {
    const { tuesday } = seed(db);

    expect(getSpendToday(db)).toBeCloseTo(3, 10);

    // Both rows share model and provider, so they are one group: the excluded
    // row must be dropped from inside it, not take the group down with it.
    const byModel = getCostByModel(db);
    expect(byModel).toHaveLength(1);
    expect(byModel[0].total_cost_usd).toBeCloseTo(3, 10);
    expect(byModel[0].entry_count).toBe(1);

    const total = getCostTimeseries(db).reduce((sum, d) => sum + d.total_cost_usd, 0);
    expect(total).toBeCloseTo(3, 10);

    // Filtered to the reconnected agent there is nothing left to chart, which
    // is the timeseries reading of "reads zero for a marked agent's own
    // summary, deliberately" above.
    const filtered = getCostTimeseries(db, { agent_id: tuesday.id })
      .reduce((sum, d) => sum + d.total_cost_usd, 0);
    expect(filtered).toBeCloseTo(0, 10);
  });

  it("applies to the agent, milestone and project summaries", () => {
    const { project, milestone, tuesday, cursor } = seed(db);

    expect(getAgentCostSummary(db, tuesday.id).total_cost_usd).toBeCloseTo(0, 10);
    expect(getAgentCostSummary(db, cursor.id).total_cost_usd).toBeCloseTo(3, 10);
    expect(getMilestoneCostSummary(db, milestone.id).total_cost_usd).toBeCloseTo(3, 10);
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(3, 10);
    expect(getGlobalCostSummary(db).total_cost_usd).toBeCloseTo(3, 10);
  });
});

describe("the edges of the identity match", () => {
  // Three behaviours that fall out of the identity being derived at query time
  // from COALESCE(client_name, name) and compared as plain TEXT. None is a bug
  // report; each is pinned so it stays a decision rather than a surprise.

  it("moves a row out from under the mark when its client name changes", () => {
    // The mark lives in cost_observed_identities, not on the agent row, so
    // re-registering under a different client name moves the row to a
    // different identity with no write to that table. The row's suppressed
    // spend comes back and nothing records that it did.
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, agent.id, true);
    logCost(db, {
      agent_id: agent.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 5,
    });
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(0, 10);

    // registerAgent matches on the normalised name, so this is the SAME row
    // with its client name overwritten.
    const renamed = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "acme-tool",
    });
    expect(renamed.id).toBe(agent.id);
    expect(renamed.cost_observed_externally).toBe(0);
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(5, 10);

    // The mark itself is unharmed: it is the row that walked away from it, so
    // a genuine claude-code connection is still excluded.
    const another = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    expect(another.cost_observed_externally).toBe(1);
  });

  it("matches the identity case-sensitively, unlike agent names", () => {
    // The two lookups disagree by design of their storage: registerAgent
    // matches on a lowercased, punctuation-folded name, while identity is a
    // plain TEXT PRIMARY KEY and so compares case-sensitively. A client that
    // capitalised its name differently between connections would not inherit
    // the mark. MCP client names are stable strings, so this is a pin rather
    // than a defect.
    const project = createProject(db, { name: "demo", description: null });
    const marked = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "Claude-Code",
    });
    setAgentCostObserved(db, marked.id, true);

    const otherCase = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    expect(otherCase.cost_observed_externally).toBe(0);

    logCost(db, {
      agent_id: otherCase.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 5,
    });
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(5, 10);
  });

  it("treats an empty client name as an identity of its own", () => {
    // COALESCE substitutes on NULL only, so client_name: "" is not a missing
    // client name — the empty string becomes the identity, and marking one
    // such agent covers every other agent that recorded one too. Nothing
    // writes an empty client name today (the MCP path records the client's
    // declared name), so this pins a latent shape rather than a live one.
    const project = createProject(db, { name: "demo", description: null });
    const blank = registerAgent(db, {
      name: "tool-a1b2c3d4", model: null, capabilities: [], client_name: "",
    });
    setAgentCostObserved(db, blank.id, true);

    const alsoBlank = registerAgent(db, {
      name: "unrelated-9f8e7d6c", model: null, capabilities: [], client_name: "",
    });
    expect(alsoBlank.cost_observed_externally).toBe(1);

    // An agent with no client name at all is unaffected: it falls back to its
    // own name, which is not the empty string.
    const noClient = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });
    expect(noClient.cost_observed_externally).toBe(0);

    logCost(db, {
      agent_id: alsoBlank.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 5,
    });
    logCost(db, {
      agent_id: noClient.id, project_id: project.id, model: "claude-opus-5",
      provider: "anthropic", input_tokens: 1, output_tokens: 1, cost_usd: 3,
    });
    expect(getProjectCostSummary(db, project.id).total_cost_usd).toBeCloseTo(3, 10);
  });
});
