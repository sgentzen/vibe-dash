import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { getAgentByName } from "../server/db/index.js";
import { handleTool } from "../server/mcp/tools.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const args = {
  model: "claude-opus-5", provider: "anthropic",
  input_tokens: 10, output_tokens: 10, cost_usd: 1,
};

describe("log_cost agent attribution", () => {
  it("attaches the session agent when agent_id is omitted", async () => {
    await handleTool(db, "log_cost", { ...args }, "claude");

    const agent = getAgentByName(db, "claude");
    expect(agent).not.toBeNull();

    const row = db.prepare(`SELECT agent_id FROM cost_entries`).get() as { agent_id: string | null };
    expect(row.agent_id).toBe(agent!.id);
  });

  it("prefers an explicit agent_id over the session name", async () => {
    await handleTool(db, "log_cost", { ...args }, "session-agent");
    const sessionAgent = getAgentByName(db, "session-agent")!;

    await handleTool(db, "log_cost", { ...args, agent_id: sessionAgent.id }, "someone-else");

    const rows = db.prepare(`SELECT agent_id FROM cost_entries`).all() as { agent_id: string | null }[];
    expect(rows.every((r) => r.agent_id === sessionAgent.id)).toBe(true);
  });

  it("still writes the row when there is no agent_id and no session name", async () => {
    // The documented limitation: unattributable, so unexcludable, but never lost.
    await handleTool(db, "log_cost", { ...args });

    const row = db.prepare(`SELECT agent_id, cost_usd FROM cost_entries`).get() as
      { agent_id: string | null; cost_usd: number };
    expect(row.agent_id).toBeNull();
    expect(row.cost_usd).toBeCloseTo(1, 10);
  });
});
