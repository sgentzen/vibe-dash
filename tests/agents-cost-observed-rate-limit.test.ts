import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import type { Express } from "express";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { registerAgent } from "../server/db/index.js";
import { agentRoutes } from "../server/routes/agents.js";
import { requestApp } from "./http-helper.js";

let db: Database.Database;
let app: Express;

// The limiter behind POST /api/agents/:id/cost-observed is created once at
// module scope, so its 30-per-minute budget is shared by every request in the
// importing test file. This file exists purely to exhaust that budget: keeping
// it apart from tests/agents-cost-observed.test.ts means neither file's request
// count can silently starve the other.
//
// KEEP THIS FILE TO EXACTLY ONE TEST. beforeEach rebuilds db and app, but it
// cannot reset the limiter — it is neither exported nor resettable — so the
// single test below leaves the budget spent. A second test added here would
// start at zero remaining and fail in a way that looks like a broken route.
beforeEach(() => {
  db = createTestDb();
  app = express();
  app.use(express.json());
  app.use(agentRoutes(db, () => {}));
});

describe("POST /api/agents/:id/cost-observed rate limiting", () => {
  it("429s the 31st request inside the window", async () => {
    const agent = registerAgent(db, { name: "claude", model: "claude-opus-5", capabilities: [] });
    const path = `/api/agents/${agent.id}/cost-observed`;

    for (let i = 0; i < 30; i++) {
      const res = await requestApp(app, "POST", path, { observed: true });
      expect(res.status).toBe(200);
    }

    const limited = await requestApp(app, "POST", path, { observed: true });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many agent changes, please try again later." });
  });
});
