import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// /mcp exposes every MCP tool with no authentication, so it relies entirely
// on the Host check and the cross-site guard that server/index.ts mounts ahead
// of it (SEC-2, SEC-5). The MCP SDK's own transport options for this
// (enableDnsRebindingProtection, allowedHosts, allowedOrigins) are deprecated
// in favour of exactly that external middleware, so the ordering in
// server/index.ts is the whole protection. A test that mounted the middleware
// on an app of its own would pass whatever server/index.ts did, so this one
// starts the real server.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "boundary-test", version: "1.0.0" } },
});

// What a page on another site can send without a CORS preflight: text/plain
// is a "simple" content type, and the SDK still reads this one as JSON
// because it contains "application/json". A test that sent application/json
// would be stopped by the browser's preflight before any server code ran.
const SIMPLE_JSON = "text/plain; application/json";

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
}

/** A request with exactly these headers; unlike fetch, node:http lets a test set Host. */
function send(
  port: number,
  method: string,
  urlPath: string,
  headers: Record<string, string>,
  body?: string
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, timeout: 5000 }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on("timeout", () => req.destroy(new Error(`${method} ${urlPath} timed out`)));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function postMcp(port: number, headers: Record<string, string>): Promise<Reply> {
  return send(
    port,
    "POST",
    "/mcp",
    { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    INITIALIZE
  );
}

describe("/mcp behind the network boundary (SEC-2, SEC-5)", () => {
  let dir: string;
  let port: number;
  let server: ChildProcess;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-mcp-boundary-"));
    port = await freePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      LOG_LEVEL: "warn",
      VIBE_DASH_DB: path.join(dir, "vibe-dash.db"),
      VIBE_DASH_CLAUDE_HOME: path.join(dir, "no-transcripts"),
    };
    // The allow-list under test must be the built-in loopback one, whatever
    // the developer running the suite has configured.
    delete env.VIBE_DASH_ALLOWED_HOSTS;
    server = spawn(process.execPath, ["--import", "tsx", path.join(ROOT, "server", "index.ts")], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // pino writes to stdout, including why the server gave up at startup.
    let output = "";
    server.stdout?.on("data", (chunk) => (output += chunk.toString()));
    server.stderr?.on("data", (chunk) => (output += chunk.toString()));

    const deadline = Date.now() + 20000;
    for (;;) {
      const reply = await send(port, "GET", "/api/health", { host: `127.0.0.1:${port}` }).catch(() => undefined);
      if (reply?.status === 200) break;
      if (server.exitCode !== null || Date.now() > deadline) {
        throw new Error(`server did not come up (exit ${server.exitCode}):\n${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // A 200 from something else that took the port first would make every
    // test below meaningless.
    if (server.exitCode !== null) throw new Error(`the server exited after answering:\n${output}`);
  }, 30000);

  afterAll(async () => {
    if (server?.exitCode === null) {
      server.kill();
      await once(server, "exit");
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("refuses a request addressed to another host, which is what a DNS-rebinding page sends", async () => {
    const reply = await postMcp(port, { host: `evil.example:${port}` });
    expect(reply.status).toBe(421);
  });

  it("refuses the event stream to another host too", async () => {
    const reply = await send(port, "GET", "/mcp", { host: `evil.example:${port}`, accept: "text/event-stream" });
    expect(reply.status).toBe(421);
  });

  it("refuses a simple cross-site POST from a page on another origin", async () => {
    const reply = await postMcp(port, {
      host: `127.0.0.1:${port}`,
      origin: "http://evil.example",
      "content-type": SIMPLE_JSON,
    });
    expect(reply.status).toBe(403);
  });

  it("refuses a request the browser marks as cross-site", async () => {
    const reply = await postMcp(port, {
      host: `127.0.0.1:${port}`,
      "sec-fetch-site": "cross-site",
      "content-type": SIMPLE_JSON,
    });
    expect(reply.status).toBe(403);
  });

  it("lets an MCP client on this machine through to the MCP server", async () => {
    const reply = await postMcp(port, { host: `127.0.0.1:${port}` });
    expect(reply.status).toBe(200);
    // Only the MCP transport issues a session id, so this is not some other handler's 200.
    expect(reply.headers["mcp-session-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
