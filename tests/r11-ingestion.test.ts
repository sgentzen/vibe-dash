import { describe, it, expect, beforeEach } from "vitest";
import express, { type Express } from "express";
import { createServer, type IncomingMessage } from "http";
import http from "http";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { ingestionRoutes } from "../server/ingestion/index.js";
import { _resetAuthCache } from "../server/auth.js";
import {
  createIngestionSource,
  listIngestionSources,
  getUnprocessedEvents,
  listIngestionEvents,
  hashToken,
} from "../server/db/ingestion.js";
import { fromClaudeCodeHook, fromGeneric, fromAiderEvent, fromCursorEvent, fromCodexEvent, fromCopilotEvent } from "../server/ingestion/normalizer.js";

let app: Express;
let db: Database.Database;

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
          ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
        },
      };
      const req = http.request(options, (res: IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk; });
        res.on("end", () => {
          server.close();
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      });
      req.on("error", (err: Error) => { server.close(); reject(err); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

beforeEach(() => {
  _resetAuthCache();
  db = createTestDb();
  app = express();
  app.use(express.json());
  // Mount only the ingestion routes — no global auth middleware needed here
  const noop = () => {};
  app.use(ingestionRoutes(db, noop as never));
});

// ─── Normalizer unit tests ────────────────────────────────────────────────────

describe("normalizer: fromClaudeCodeHook", () => {
  it("normalizes Stop hook to session_end with cost", () => {
    const result = fromClaudeCodeHook({
      hook_event_name: "Stop",
      stop_reason: "task_complete",
      session_id: "sess-123",
      cost_usd: 0.0042,
      input_tokens: 1000,
      output_tokens: 500,
      model: "claude-sonnet-4-6",
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("session_end");
    expect(result!.cost_usd).toBe(0.0042);
    expect(result!.input_tokens).toBe(1000);
    expect(result!.provider).toBe("anthropic");
  });

  it("normalizes PreToolUse to tool_call", () => {
    const result = fromClaudeCodeHook({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      session_id: "sess-123",
    });
    expect(result!.kind).toBe("tool_call");
    expect(result!.tool_name).toBe("Read");
  });

  it("normalizes PostToolUse with Write tool to file_change", () => {
    const result = fromClaudeCodeHook({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      session_id: "sess-123",
      tool_input: { file_path: "/src/foo.ts" },
    });
    expect(result!.kind).toBe("file_change");
    expect(result!.file_path).toBe("/src/foo.ts");
  });

  it("normalizes UserPromptSubmit to session_start", () => {
    const result = fromClaudeCodeHook({
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-abc",
    });
    expect(result!.kind).toBe("session_start");
  });

  it("returns null for unknown hook event", () => {
    const result = fromClaudeCodeHook({ hook_event_name: "Unknown" });
    expect(result).toBeNull();
  });

  it("returns null when no hook_event_name", () => {
    const result = fromClaudeCodeHook({ foo: "bar" });
    expect(result).toBeNull();
  });
});

describe("normalizer: fromGeneric", () => {
  it("passes through valid kind", () => {
    const result = fromGeneric({ kind: "cost", agent_name: "mybot", cost_usd: 0.001, model: "gpt-4o", provider: "openai" });
    expect(result!.kind).toBe("cost");
    expect(result!.agent_name).toBe("mybot");
    expect(result!.cost_usd).toBe(0.001);
  });

  it("defaults to activity for unknown kind", () => {
    const result = fromGeneric({ kind: "unknown_kind", message: "hello" });
    expect(result!.kind).toBe("activity");
    expect(result!.message).toBe("hello");
  });

  it("passes through task_id", () => {
    const result = fromGeneric({ kind: "activity", task_id: "task-uuid", message: "done" });
    expect(result!.task_id).toBe("task-uuid");
  });
});

describe("normalizer: fromAiderEvent", () => {
  it("handles cost type", () => {
    const result = fromAiderEvent({ type: "cost", cost: 0.005, tokens_sent: 400, tokens_received: 200, model: "gpt-4o" });
    expect(result!.kind).toBe("cost");
    expect(result!.cost_usd).toBe(0.005);
  });

  it("handles bare JSON line with total_cost_usd", () => {
    const result = fromAiderEvent({ total_cost_usd: 0.002, model: "claude-3" });
    expect(result!.kind).toBe("cost");
    expect(result!.cost_usd).toBe(0.002);
  });
});

describe("normalizer: fromCursorEvent", () => {
  it("handles session_start", () => {
    const result = fromCursorEvent({ type: "session_start", agent_id: "cursor-abc" });
    expect(result!.kind).toBe("session_start");
    expect(result!.agent_name).toBe("cursor-abc");
  });

  it("handles file_edit", () => {
    const result = fromCursorEvent({ type: "file_edit", agent_id: "cursor-abc", file: "/a/b.ts" });
    expect(result!.kind).toBe("file_change");
    expect(result!.file_path).toBe("/a/b.ts");
  });
});

describe("normalizer: fromCodexEvent", () => {
  it("handles assistant role with usage", () => {
    const result = fromCodexEvent({ role: "assistant", content: "done", usage: { input_tokens: 100, output_tokens: 50 }, model: "gpt-4o-mini" });
    expect(result!.kind).toBe("activity");
    expect(result!.input_tokens).toBe(100);
  });

  it("returns null for missing role", () => {
    const result = fromCodexEvent({ content: "foo" });
    expect(result).toBeNull();
  });
});

describe("normalizer: fromCopilotEvent", () => {
  it("handles session.start", () => {
    const result = fromCopilotEvent({ action: "session.start", workspace_id: "ws-1" });
    expect(result!.kind).toBe("session_start");
  });

  it("handles edit", () => {
    const result = fromCopilotEvent({ action: "edit", workspace_id: "ws-1", file: "/src/x.ts" });
    expect(result!.kind).toBe("file_change");
  });
});

// ─── DB functions ─────────────────────────────────────────────────────────────

describe("ingestion DB: createIngestionSource", () => {
  it("creates source and returns one-time token", () => {
    const result = createIngestionSource(db, { name: "test-source", kind: "claude_code" });
    expect(result.id).toBeTruthy();
    expect(result.token).toHaveLength(64);
    expect(result.kind).toBe("claude_code");
    expect(result.active).toBe(true);
  });

  it("hashed token looks up source correctly", async () => {
    const result = createIngestionSource(db, { name: "src", kind: "generic" });
    const { getIngestionSourceByTokenHash } = await import("../server/db/ingestion.js");
    const found = getIngestionSourceByTokenHash(db, hashToken(result.token));
    expect(found?.id).toBe(result.id);
  });

  it("lists sources", () => {
    createIngestionSource(db, { name: "a", kind: "cursor" });
    createIngestionSource(db, { name: "b", kind: "aider" });
    const list = listIngestionSources(db);
    expect(list).toHaveLength(2);
  });
});

// ─── HTTP endpoints ───────────────────────────────────────────────────────────

describe("POST /api/ingest/sources", () => {
  it("creates a source and returns token", async () => {
    const { status, body } = await request("POST", "/api/ingest/sources", {
      name: "my-source",
      kind: "claude_code",
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.id).toBeTruthy();
    expect(b.token).toBeTruthy();
    expect(b.kind).toBe("claude_code");
  });

  it("returns 400 for missing name", async () => {
    const { status } = await request("POST", "/api/ingest/sources", { kind: "claude_code" });
    expect(status).toBe(400);
  });

  it("returns 400 for invalid kind", async () => {
    const { status } = await request("POST", "/api/ingest/sources", { name: "x", kind: "invalid" });
    expect(status).toBe(400);
  });
});

describe("GET /api/ingest/sources", () => {
  it("lists sources", async () => {
    createIngestionSource(db, { name: "s1", kind: "generic" });
    const { status, body } = await request("GET", "/api/ingest/sources");
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("POST /api/ingest/:source_kind (event ingest)", () => {
  it("returns 401 without token", async () => {
    const { status } = await request("POST", "/api/ingest/claude_code", { hook_event_name: "Stop" });
    expect(status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const { status } = await request(
      "POST", "/api/ingest/claude_code",
      { hook_event_name: "Stop" },
      { Authorization: "Bearer wrongtoken" }
    );
    expect(status).toBe(401);
  });

  it("accepts valid token and queues event", async () => {
    const src = createIngestionSource(db, { name: "src", kind: "claude_code" });
    const { status, body } = await request(
      "POST", "/api/ingest/claude_code",
      { hook_event_name: "Stop", session_id: "s1", cost_usd: 0.001, model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 50 },
      { Authorization: `Bearer ${src.token}` }
    );
    expect(status).toBe(202);
    expect((body as Record<string, unknown>).queued).toBe(true);
    // Use listIngestionEvents (all events) since materializer may have already
    // processed the event via setImmediate before we query.
    const events = listIngestionEvents(db, { source_id: src.id });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].source_id).toBe(src.id);
  });

  it("returns 400 for unknown source_kind in URL", async () => {
    const src = createIngestionSource(db, { name: "src", kind: "generic" });
    const { status } = await request(
      "POST", "/api/ingest/unknownkind",
      { kind: "activity" },
      { Authorization: `Bearer ${src.token}` }
    );
    expect(status).toBe(400);
  });
});

describe("POST /api/ingest/sources/:id/rotate", () => {
  it("rotates token and old token stops working", async () => {
    const src = createIngestionSource(db, { name: "src2", kind: "generic" });
    const oldToken = src.token;

    const { status, body } = await request("POST", `/api/ingest/sources/${src.id}/rotate`);
    expect(status).toBe(200);
    const newToken = (body as Record<string, unknown>).token as string;
    expect(newToken).not.toBe(oldToken);

    // Old token should now 401
    const { status: oldStatus } = await request(
      "POST", "/api/ingest/generic",
      { kind: "activity" },
      { Authorization: `Bearer ${oldToken}` }
    );
    expect(oldStatus).toBe(401);
  });
});

describe("DELETE /api/ingest/sources/:id", () => {
  it("deletes a source", async () => {
    const src = createIngestionSource(db, { name: "del-me", kind: "generic" });
    const { status } = await request("DELETE", `/api/ingest/sources/${src.id}`);
    expect(status).toBe(204);
    expect(listIngestionSources(db)).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const { status } = await request("DELETE", "/api/ingest/sources/nonexistent");
    expect(status).toBe(404);
  });
});

describe("Materializer idempotency", () => {
  it("processing same event twice does not duplicate cost rows", async () => {
    const src = createIngestionSource(db, { name: "m-src", kind: "generic" });
    const payload = { kind: "cost", agent_name: "bot", model: "gpt-4o", provider: "openai", cost_usd: 0.01, input_tokens: 100, output_tokens: 50 };

    // Ingest event
    await request("POST", "/api/ingest/generic", payload, { Authorization: `Bearer ${src.token}` });

    // Run materializer twice (it may have already run via setImmediate)
    const { runMaterializer } = await import("../server/ingestion/materializer.js");
    runMaterializer(db);
    runMaterializer(db);
    runMaterializer(db);

    // Should have only 1 cost entry (event marked processed after first run)
    const costRows = db.prepare("SELECT * FROM cost_entries").all();
    expect(costRows).toHaveLength(1);
  });
});
