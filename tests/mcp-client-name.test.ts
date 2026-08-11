import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createMcpServer } from "../server/mcp/server.js";
import { getAgentByName } from "../server/db/index.js";

// Mock websocket broadcast — we don't need a live WebSocket server in tests
vi.mock("../server/websocket.js", () => ({
  broadcast: vi.fn(),
}));

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── oninitialized registers the client name ──────────────────────────────────
//
// This drives the actual registration path (oninitialized), not registerAgent
// directly. tests/cost-identity.test.ts pins registerAgent's own behaviour but
// never exercises server.ts's oninitialized handler, so it would not notice if
// `client_name: info.name` were deleted from that call. This test would: it
// stubs getClientVersion() on the low-level Server the SDK's McpServer wraps,
// then invokes oninitialized() directly, the same way the SDK does on a real
// MCP handshake.

describe("MCP oninitialized records the client name", () => {
  it("records the client name while keeping the suffixed agent name", () => {
    const handle = createMcpServer(db, "connection-id-1");

    // Stub the client info the real transport would have negotiated
    handle.server.server.getClientVersion = () => ({ name: "claude-code", version: "1.0" });
    handle.server.server.oninitialized!();

    // The agent name carries the connection-unique suffix, so find it by
    // prefix rather than guessing the exact suffix value.
    const rows = db.prepare("SELECT name FROM agents WHERE name LIKE 'claude-code-%'").all() as { name: string }[];
    expect(rows).toHaveLength(1);

    const registered = getAgentByName(db, rows[0].name);
    expect(registered).not.toBeNull();
    expect(registered!.client_name).toBe("claude-code");
    // The suffix must survive: a future "simplification" to the bare client
    // name would collapse concurrent connections onto a single agent row.
    expect(registered!.name).not.toBe("claude-code");
    expect(registered!.name.startsWith("claude-code-")).toBe(true);
  });
});

// ─── A blank client name must not become a shared identity ────────────────────
//
// The MCP schema types clientInfo.name as a bare string, so "" is accepted. An
// agent's cost identity is COALESCE(client_name, name), and both that and
// agentCostIdentity's ?? treat "" as a real value rather than a fallback. If a
// blank name were recorded as-is, every blank-named client would resolve to the
// single identity "", and marking one would suppress a different client's
// genuine, non-duplicated spend. That is real money vanishing from totals,
// which is worse than the double counting this whole feature exists to fix.

describe("a blank client name", () => {
  const registerWithName = (db: Database.Database, name: string, connectionId: string): void => {
    const handle = createMcpServer(db, connectionId);
    handle.server.server.getClientVersion = () => ({ name, version: "1.0" });
    handle.server.server.oninitialized!();
  };

  it("is stored as null rather than an empty string", () => {
    registerWithName(db, "", "connection-blank-1");

    const row = db
      .prepare("SELECT client_name FROM agents LIMIT 1")
      .get() as { client_name: string | null };
    expect(row.client_name).toBeNull();
  });

  it("leaves two blank-named clients with distinct identities", () => {
    // The suffix is connectionId.slice(0, 8), so these ids must differ within
    // their first 8 characters or both connections register as one agent.
    registerWithName(db, "", "aaaaaaaa-blank-1");
    registerWithName(db, "", "bbbbbbbb-blank-2");

    const identities = db
      .prepare("SELECT COALESCE(client_name, name) AS identity FROM agents")
      .all() as { identity: string }[];

    expect(identities).toHaveLength(2);
    expect(new Set(identities.map((r) => r.identity)).size).toBe(2);
    // And neither collapsed to the empty string, which is the shared-identity bug.
    expect(identities.every((r) => r.identity.length > 0)).toBe(true);
  });

  it("still records a real client name", () => {
    // The guard must not swallow the ordinary case.
    registerWithName(db, "claude-code", "connection-real-1");

    const row = db
      .prepare("SELECT client_name FROM agents LIMIT 1")
      .get() as { client_name: string | null };
    expect(row.client_name).toBe("claude-code");
  });
});
