import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import { WebSocket, type WebSocketServer } from "ws";
import { initWebSocket } from "../server/websocket.js";
import { buildAllowedNetwork } from "../server/security/origin.js";
import { logger } from "../server/logger.js";

// The allow-list is built for a nominal port (3001) independent of whichever
// ephemeral port the one-shot server below actually binds — the Host header
// on the handshake request is what's under test, not the real TCP port, same
// as tests/security-network-boundary.test.ts.
const NOMINAL_PORT = 3001;

let server: Server | undefined;
let wss: WebSocketServer | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  // Upgraded sockets leave the http.Server's connection tracking, so close()
  // would wait on any accepted WebSocket still open; terminate them first.
  for (const client of wss?.clients ?? []) client.terminate();
  wss?.close();
  wss = undefined;
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
    wss = initWebSocket(server, buildAllowedNetwork(NOMINAL_PORT));
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

/**
 * Sends a raw upgrade request (the ws client cannot emit malformed or
 * non-origin-form targets) and resolves with the status line the server sent
 * before closing the socket, or "timeout" if the socket was left open. An
 * accepted (101) upgrade stays open by design, so that status resolves at once.
 */
function rawUpgrade(
  port: number,
  target: string,
  host = `localhost:${NOMINAL_PORT}`,
  origin?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    let settled = false;
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("timeout"), 2000);
    socket.on("connect", () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\n` +
          `Host: ${host}\r\n` +
          (origin ? `Origin: ${origin}\r\n` : "") +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
    });
    const statusLine = () => response.split("\r\n")[0] ?? "";
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (response.includes("\r\n") && statusLine().startsWith("HTTP/1.1 101 ")) finish(statusLine());
    });
    socket.on("error", () => {});
    socket.on("close", () => finish(statusLine() || "closed-no-response"));
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

describe("WebSocket upgrade request-target handling", () => {
  // Legacy url.parse threw URIError on these before any trust check ran, which
  // escaped the 'upgrade' listener as an uncaught exception. A 400 means Node's
  // own parser refused the target first; either way the socket must close and
  // the server must keep serving.
  it.each(["//%zz@h/ws", "http://%zz@h/ws"])(
    "answers and closes a malformed target %s without crashing",
    async (target) => {
      const port = await listen();
      const status = await rawUpgrade(port, target);
      expect(status).toMatch(/^HTTP\/1\.1 (400|404) /);
      expect(await attemptUpgrade(port, { Host: "localhost:3001" })).toBe("open");
    },
  );

  it("answers and closes an upgrade to a path other than /ws", async () => {
    const port = await listen();
    expect(await rawUpgrade(port, "/other")).toBe("HTTP/1.1 404 Not Found");
  });

  it("refuses a non-/ws upgrade even when its Host is foreign", async () => {
    const port = await listen();
    expect(await rawUpgrade(port, "/mcp", "evil.example.com")).toBe("HTTP/1.1 404 Not Found");
  });

  it("still routes /ws with a query string", async () => {
    const port = await listen();
    expect(await rawUpgrade(port, "/ws?client=dashboard")).toBe("HTTP/1.1 101 Switching Protocols");
  });

  it("answers and closes /ws with a foreign Host or Origin with 403", async () => {
    const port = await listen();
    expect(await rawUpgrade(port, "/ws", "evil.example.com")).toBe("HTTP/1.1 403 Forbidden");
    expect(await rawUpgrade(port, "/ws", undefined, "http://attacker.example")).toBe("HTTP/1.1 403 Forbidden");
    expect(wss!.clients.size).toBe(0);
  });

  // Only the origin-form /ws path (optionally with a query) is routed. The
  // absolute form was accepted by the old url.parse and is now refused on
  // purpose; no supported client or proxy sends it to an origin server. A 400
  // means Node's own parser refused the target before the listener ran.
  it.each(["/ws/", "/WS", "/wsx", "/ws%2F", "//ws", "/ws/../ws", "/ws;x", `http://localhost:${NOMINAL_PORT}/ws`])(
    "does not route %s",
    async (target) => {
      const port = await listen();
      expect(await rawUpgrade(port, target)).toMatch(/^HTTP\/1\.1 (400|404) /);
    },
  );

  it.each(["/ws?", "/ws??", "/ws?a=b?c"])("routes %s", async (target) => {
    const port = await listen();
    expect(await rawUpgrade(port, target)).toBe("HTTP/1.1 101 Switching Protocols");
  });
});

describe("WebSocket upgrade listener, driven directly", () => {
  // Calling the registered listener with a stub socket pins the two crash
  // paths without depending on how a given Node version's HTTP parser treats
  // the bytes on the wire.
  function upgradeListener(): (req: IncomingMessage, socket: PassThrough, head: Buffer) => void {
    const target = createServer();
    initWebSocket(target, buildAllowedNetwork(NOMINAL_PORT));
    return target.listeners("upgrade")[0] as (req: IncomingMessage, socket: PassThrough, head: Buffer) => void;
  }

  function stubRequest(url: string): IncomingMessage {
    return { url, headers: { host: `localhost:${NOMINAL_PORT}` } } as unknown as IncomingMessage;
  }

  it.each(["//%zz@h/ws", "http://%zz@h/ws", ""])("refuses target %j without throwing", (url) => {
    const socket = new PassThrough();
    expect(() => upgradeListener()(stubRequest(url), socket, Buffer.alloc(0))).not.toThrow();
    expect(socket.destroyed).toBe(true);
  });

  it("handles a socket error after refusing instead of leaving it unhandled", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const socket = new PassThrough();
    upgradeListener()(stubRequest("/other"), socket, Buffer.alloc(0));
    expect(() => socket.emit("error", new Error("ECONNRESET"))).not.toThrow();
    expect(warn).toHaveBeenCalledOnce();
  });
});
