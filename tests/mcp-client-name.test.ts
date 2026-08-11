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
