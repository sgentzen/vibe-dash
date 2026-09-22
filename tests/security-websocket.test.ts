import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { WebSocket } from "ws";
import { initWebSocket } from "../server/websocket.js";
import { buildAllowedNetwork } from "../server/security/origin.js";

// The allow-list is built for a nominal port (3001) independent of whichever
// ephemeral port the one-shot server below actually binds — the Host header
// on the handshake request is what's under test, not the real TCP port, same
// as tests/security-network-boundary.test.ts.
const NOMINAL_PORT = 3001;

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

function listen(): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    initWebSocket(server, buildAllowedNetwork(NOMINAL_PORT));
    server.listen(0, "127.0.0.1", () => {
      resolve((server!.address() as { port: number }).port);
    });
  });
}

/** Attempts the WS handshake and resolves with whether it was accepted. */
function attemptUpgrade(port: number, headers: Record<string, string>): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    let settled = false;
    const finish = (result: "open" | "refused") => {
      if (settled) return;
      settled = true;
      ws.terminate();
      resolve(result);
    };
    ws.on("open", () => finish("open"));
    ws.on("unexpected-response", () => finish("refused"));
    ws.on("error", () => finish("refused"));
  });
}

describe("WebSocket upgrade Host/Origin check (SEC-1)", () => {
  it("accepts an upgrade with an allowed Host and no Origin", async () => {
    const port = await listen();
    const result = await attemptUpgrade(port, { Host: "localhost:3001" });
    expect(result).toBe("open");
  });

  it("accepts an upgrade with an allowed Host and an allowed Origin", async () => {
    const port = await listen();
    const result = await attemptUpgrade(port, { Host: "localhost:3001", Origin: "http://localhost:3001" });
    expect(result).toBe("open");
  });

  it("refuses an upgrade whose Origin is foreign, even with a valid Host", async () => {
    const port = await listen();
    const result = await attemptUpgrade(port, {
      Host: "localhost:3001",
      Origin: "http://attacker.example",
    });
    expect(result).toBe("refused");
  });

  it("refuses an upgrade whose Host is foreign", async () => {
    const port = await listen();
    const result = await attemptUpgrade(port, { Host: "evil.example.com" });
    expect(result).toBe("refused");
  });
});
