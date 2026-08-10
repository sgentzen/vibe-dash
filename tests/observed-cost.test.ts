import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, getAgentById, setAgentCostObserved } from "../server/db/index.js";

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
