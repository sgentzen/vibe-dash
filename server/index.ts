import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import type Database from "better-sqlite3";
import { openDb, backfillMilestoneDailyStats } from "./db/index.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes.js";
import { notFoundHandler, errorHandler } from "./routes/middleware.js";
import { logger } from "./logger.js";
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
app.use(express.json());

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

// Serve built frontend in production (npm start)
const distDir = path.join(PROJECT_ROOT, "dist");
app.use(express.static(distDir));
app.get("/{*splat}", spaLimiter, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

// Centralized error handler — must be last middleware
app.use(errorHandler);

const server = createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  logger.info({ port: PORT }, "Vibe Dash running");
  logger.info({ port: PORT, path: "/ws" }, "WebSocket available");
  logger.info({ port: PORT, path: "/sse" }, "MCP SSE available");
  // Backfill milestone daily stats so the dashboard has data immediately
  const backfilled = backfillMilestoneDailyStats(db);
  if (backfilled > 0) logger.info({ count: backfilled }, "Backfilled daily stats for milestones");
});

export { app, db, server };
