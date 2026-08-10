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

  it("writes the row instead of throwing when agent_id is an empty string", async () => {
    // "" is schema-valid (no .min(1)) and is an FK column. `?? null` treats
    // "" as present, so an unnormalised handler passes it straight to the DB
    // and the FK constraint throws, losing the row entirely.
    await handleTool(db, "log_cost", { ...args, agent_id: "" });

    const rows = db.prepare(`SELECT agent_id FROM cost_entries`).all() as { agent_id: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_id).toBeNull();
  });

  it("writes the row instead of throwing when task_id is an empty string", async () => {
    // Same defect, same FK-column shape: task_id, milestone_id and project_id
    // all go through the identical `?? null` pattern as agent_id.
    await handleTool(db, "log_cost", { ...args, task_id: "" });

    const rows = db.prepare(`SELECT task_id FROM cost_entries`).all() as { task_id: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].task_id).toBeNull();
  });
});
