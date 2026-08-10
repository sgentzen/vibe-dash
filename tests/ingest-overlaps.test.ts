import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject, registerAgent, setAgentCostObserved } from "../server/db/index.js";
import { getIngestStatus } from "../server/ingest/transcripts/sync.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

const AT = (day: string): string => `${day}T10:00:00.000Z`;

function addCost(
  db: Database.Database,
  opts: { id: string; project: string; agent?: string | null; source: "mcp" | "transcript"; day: string }
): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, ?, ?, 'claude-opus-5', 'anthropic', 1, 1, 1, ?, ?, ?)`
  ).run(opts.id, opts.agent ?? null, opts.project, AT(opts.day), opts.source,
        opts.source === "transcript" ? `uuid-${opts.id}` : null);
}

describe("getIngestStatus overlaps", () => {
  it("reports a project and day carrying both sources", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap).toMatchObject({
      project_id: project.id,
      project_name: "demo",
      date: "2026-08-10",
      mcp_entries: 1,
      transcript_entries: 1,
    });
    expect(overlap.mcp_agent_names).toEqual(["claude"]);
  });

  it("stays quiet when the two sources fall on different days", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-09" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    expect(getIngestStatus(db).overlaps).toEqual([]);
  });

  it("names every distinct agent on the mcp side", () => {
    const project = createProject(db, { name: "demo", description: null });
    const a = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    const b = registerAgent(db, { name: "cursor-bot", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: a.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "m2", project: project.id, agent: b.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(2);
    expect([...overlap.mcp_agent_names].sort()).toEqual(["claude", "cursor-bot"]);
  });

  it("stops reporting once the agent is marked", () => {
    const project = createProject(db, { name: "demo", description: null });
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: agent.id, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    expect(getIngestStatus(db).overlaps).toHaveLength(1);
    setAgentCostObserved(db, agent.id, true);
    expect(getIngestStatus(db).overlaps).toEqual([]);
  });

  it("still reports a self-report that named no agent", () => {
    // It cannot be excluded by marking an agent, so it must stay visible.
    const project = createProject(db, { name: "demo", description: null });
    addCost(db, { id: "m1", project: project.id, agent: null, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(1);
    expect(overlap.mcp_agent_names).toEqual([]);
  });

  it("still reports the agent-less self-report when a DIFFERENT agent is marked", () => {
    // The IS NOT NULL guard inside the shared condition is what makes this
    // pass. Without it the subquery is non-empty, NULL IN (...) is SQL NULL,
    // and the WHERE clause silently drops the row from the report.
    const project = createProject(db, { name: "demo", description: null });
    const other = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    addCost(db, { id: "m1", project: project.id, agent: null, source: "mcp", day: "2026-08-10" });
    addCost(db, { id: "t1", project: project.id, source: "transcript", day: "2026-08-10" });

    setAgentCostObserved(db, other.id, true);

    const [overlap] = getIngestStatus(db).overlaps;
    expect(overlap.mcp_entries).toBe(1);
  });

  it("is empty on a database with no cost rows", () => {
    expect(getIngestStatus(db).overlaps).toEqual([]);
  });
});
