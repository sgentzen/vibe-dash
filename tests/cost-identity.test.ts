import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerAgent,
  getAgentById,
  getAgentByName,
  listAgents,
  setAgentCostObserved,
  agentCostIdentity,
} from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

describe("agentCostIdentity", () => {
  it("is the client name when one was recorded", () => {
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4",
      model: null,
      capabilities: [],
      client_name: "claude-code",
    });
    expect(agentCostIdentity(agent)).toBe("claude-code");
  });

  it("falls back to the agent's own name when no client name was recorded", () => {
    // Agents that named themselves through register_agent or log_activity
    // already had a stable name, so one rule covers both cases.
    const agent = registerAgent(db, { name: "cursor-bot", model: null, capabilities: [] });
    expect(agentCostIdentity(agent)).toBe("cursor-bot");
  });
});

describe("marking by identity", () => {
  it("defaults to unmarked so an upgrade changes no existing total", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("marks and unmarks", () => {
    const agent = registerAgent(db, { name: "claude", model: null, capabilities: [] });

    expect(setAgentCostObserved(db, agent.id, true)!.cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);

    expect(setAgentCostObserved(db, agent.id, false)!.cost_observed_externally).toBe(0);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("returns null for an agent that does not exist", () => {
    expect(setAgentCostObserved(db, "no-such-agent", true)).toBeNull();
  });

  it("covers a LATER connection of the same client, which is the whole point", () => {
    // This is the defect the amendment exists to fix. Each MCP connection
    // registers a new agent row with a fresh random suffix, so a mark tied to
    // one row silently stopped applying the next time the client started.
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);

    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });

    expect(tuesday.id).not.toBe(monday.id);
    expect(getAgentById(db, tuesday.id)!.cost_observed_externally).toBe(1);
  });

  it("does not touch a different client", () => {
    const claude = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const cursor = registerAgent(db, {
      name: "cursor-1234abcd", model: null, capabilities: [], client_name: "cursor",
    });
    setAgentCostObserved(db, claude.id, true);

    expect(getAgentById(db, cursor.id)!.cost_observed_externally).toBe(0);
  });

  it("unmarking one connection unmarks the client, including its other rows", () => {
    const monday = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const tuesday = registerAgent(db, {
      name: "claude-code-9f8e7d6c", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, monday.id, true);
    expect(getAgentById(db, tuesday.id)!.cost_observed_externally).toBe(1);

    setAgentCostObserved(db, tuesday.id, false);
    expect(getAgentById(db, monday.id)!.cost_observed_externally).toBe(0);
  });

  it("survives re-registration of the same agent row", () => {
    // registerAgent updates on a normalised-name match rather than inserting.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, agent.id, true);

    const again = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: "claude-opus-5", capabilities: [], client_name: "claude-code",
    });
    expect(again.id).toBe(agent.id);
    expect(again.cost_observed_externally).toBe(1);
  });

  it("still lets a different tool inherit the mark by reusing the exact name", () => {
    // A known limitation, pinned so it stays deliberate. registerAgent updates
    // on a normalised-name match, so a second tool registering under a marked
    // agent's exact name is the SAME row and inherits the suppression of its
    // genuine, non-duplicated spend. Keying on the client narrows this (it no
    // longer catches every agent whose name merely resembles a marked one) but
    // does not remove it. Section 14.5 of the design records it.
    const first = registerAgent(db, { name: "shared-name", model: null, capabilities: [] });
    setAgentCostObserved(db, first.id, true);

    const second = registerAgent(db, { name: "shared-name", model: "other-tool/2.0", capabilities: [] });
    expect(second.id).toBe(first.id);
    expect(second.cost_observed_externally).toBe(1);
  });

  it("reports the flag from every agent read path", () => {
    // parseAgent spreads the row, so a read query that forgets the derived
    // column would silently report 0 for a marked agent. This pins all of them.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    setAgentCostObserved(db, agent.id, true);

    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);
    expect(getAgentByName(db, "claude-code-a1b2c3d4")!.cost_observed_externally).toBe(1);
    expect(listAgents(db).find((a) => a.id === agent.id)!.cost_observed_externally).toBe(1);
  });
});

describe("MCP registration records the client name", () => {
  it("stores the client name separately from the suffixed agent name", () => {
    // server.ts builds `${info.name}-${suffix}`. It holds both halves before
    // joining them, so the client name is recorded rather than recovered later.
    const agent = registerAgent(db, {
      name: "claude-code-a1b2c3d4",
      model: "claude-code/1.0",
      capabilities: [],
      client_name: "claude-code",
    });
    expect(agent.client_name).toBe("claude-code");
    expect(agent.name).toBe("claude-code-a1b2c3d4");
  });

  it("keeps a recorded client name when a later call omits it", () => {
    // touchAgent and other paths re-register by name without knowing the
    // client. Losing the client name there would silently unmark the agent.
    registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [], client_name: "claude-code",
    });
    const again = registerAgent(db, {
      name: "claude-code-a1b2c3d4", model: null, capabilities: [],
    });
    expect(again.client_name).toBe("claude-code");
  });
});
