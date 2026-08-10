import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent, getAgentById } from "../server/db/index.js";
import { agentRoutes } from "../server/routes/agents.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

function request(method: string, path: string, body?: unknown) {
  return requestApp(app, method, path, body);
}

beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(agentRoutes(db, () => {}));
});

describe("POST /api/agents/:id/cost-observed", () => {
  it("marks an agent and returns it", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    const res = await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });
    expect(res.status).toBe(200);
    expect((res.body as { cost_observed_externally: number }).cost_observed_externally).toBe(1);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(1);
  });

  it("unmarks an agent", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });

    const res = await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: false });
    expect(res.status).toBe(200);
    expect(getAgentById(db, agent.id)!.cost_observed_externally).toBe(0);
  });

  it("404s for an agent that does not exist", async () => {
    const res = await request("POST", "/api/agents/no-such-agent/cost-observed", { observed: true });
    expect(res.status).toBe(404);
    expect((res.body as { error?: string }).error).toBeTruthy();
  });

  it("400s when observed is missing or not a boolean", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, {})).status).toBe(400);
    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: "yes" })).status).toBe(400);
    // null and 1 are the two truthiness-adjacent values a looser check would
    // wave through, so they are pinned separately from the string case.
    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: null })).status).toBe(400);
    expect((await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: 1 })).status).toBe(400);
  });

  it("400s when the body was never parsed as JSON", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });

    // A client that omits Content-Type: application/json leaves req.body
    // undefined under Express 5. That is malformed client input, so it has to
    // read as a 400, not as an internal error.
    const res = await requestApp(
      app,
      "POST",
      `/api/agents/${agent.id}/cost-observed`,
      { observed: true },
      { contentType: "text/plain" },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe("observed must be true or false");
  });

  it("broadcasts the updated agent", async () => {
    const events: { type: string }[] = [];
    app = express();
    app.use(express.json());
    app.use(agentRoutes(db, (e) => { events.push(e as { type: string }); }));

    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    await request("POST", `/api/agents/${agent.id}/cost-observed`, { observed: true });

    expect(events.map((e) => e.type)).toContain("agent_registered");
  });
});
