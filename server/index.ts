import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import type Database from "better-sqlite3";
import helmet from "helmet";
import { openDb } from "./db/index.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/server.js";
import { randomUUID } from "crypto";
import rateLimit from "express-rate-limit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT ?? "3001");
const DB_PATH = process.env.VIBE_DASH_DB ?? path.join(PROJECT_ROOT, "vibe-dash.db");

const app = express();
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : [])],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: "256kb" }));

const db: Database.Database = openDb(DB_PATH);
app.use(createRouter(db));

const spaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 SPA index requests per windowMs
});

// MCP SSE transport
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  const handle = createMcpServer(db, transport.sessionId);
  transports.set(transport.sessionId, transport);
  res.on("close", () => {
    transports.delete(transport.sessionId);
    handle.cleanup();
  });
  await handle.server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (!transport) { res.status(400).json({ error: "Unknown session" }); return; }
  await transport.handlePostMessage(req, res);
});

// MCP Streamable HTTP transport (modern clients use this)
const httpTransports = new Map<string, { transport: StreamableHTTPServerTransport; cleanup: () => void }>();

app.all("/mcp", async (req, res) => {
  // Handle session-based routing for existing sessions
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && httpTransports.has(sessionId)) {
    const entry = httpTransports.get(sessionId)!;
    if (req.method === "DELETE") {
      entry.cleanup();
      httpTransports.delete(sessionId);
    }
    await entry.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — only POST (initialize) creates one
  if (req.method === "POST") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const handle = createMcpServer(db, transport.sessionId ?? undefined);
    transport.onclose = () => {
      handle.cleanup();
      if (transport.sessionId) httpTransports.delete(transport.sessionId);
    };
    await handle.server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      httpTransports.set(transport.sessionId, { transport, cleanup: handle.cleanup });
    }
    return;
  }

  // GET/DELETE without a valid session
  res.status(400).json({ error: "No valid MCP session. Send an initialize request first." });
});

// Return JSON 404 for unknown /api/* routes (must be before SPA fallback)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve built frontend in production (npm start)
const distDir = path.join(PROJECT_ROOT, "dist");
app.use(express.static(distDir));
app.get("/{*splat}", spaLimiter, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

// Global error handler — catches thrown errors in route handlers
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled route error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

const server = createServer(app);
initWebSocket(server);

const BIND = process.env.VIBE_DASH_BIND ?? "127.0.0.1";
if (BIND !== "127.0.0.1" && BIND !== "::1" && !process.env.VIBE_DASH_ALLOW_REMOTE) {
  console.error(`ERROR: VIBE_DASH_BIND is set to '${BIND}' (non-loopback). Set VIBE_DASH_ALLOW_REMOTE=1 to allow remote access.`);
  process.exit(1);
}

server.listen(PORT, BIND, () => {
  console.log(`Vibe Dash running on http://${BIND}:${PORT}`);
  console.log(`WebSocket available at ws://${BIND}:${PORT}/ws`);
  console.log(`MCP SSE at http://${BIND}:${PORT}/sse`);
});

export { app, db, server };
