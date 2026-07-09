import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type Database from "better-sqlite3";
import { openDb, backfillMilestoneDailyStats } from "./db/index.js";
import { resolveDbPath } from "./db/path.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./routes/middleware.js";
import { logger } from "./logger.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/server.js";
import { initPlugins } from "./routes/plugins.js";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built frontend (vite output) always lives in the package's top-level `dist/`.
// Under tsx (dev) this file is <root>/server/index.ts → dist is ../dist; once compiled
// it is <pkg>/dist/server/index.js → dist is the parent dir. Probe both layouts so the
// static SPA is served correctly whether run via `npm start` or `node dist/server/index.js`.
function resolveDistDir(): string {
  const candidates = [
    path.resolve(__dirname, "..", "dist"), // dev/tsx: <root>/server → <root>/dist
    path.resolve(__dirname, ".."),         // compiled: <pkg>/dist/server → <pkg>/dist
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? candidates[0];
}

// Rate limiter for the MCP endpoint (CodeQL js/missing-rate-limiting)
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many MCP requests, please try again later." },
});

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const DB_PATH = resolveDbPath();

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

function openDbOrExit(): Database.Database {
  try {
    return openDb(DB_PATH);
  } catch (err) {
    logger.error({ err, DB_PATH }, "Failed to open database — aborting startup");
    process.exit(1);
  }
}
const db: Database.Database = openDbOrExit();
app.use(createRouter(db));

const spaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 SPA index requests per windowMs
});

// MCP Streamable HTTP transport (modern clients use this)
const httpTransports = new Map<string, { transport: StreamableHTTPServerTransport; cleanup: () => void }>();

app.all("/mcp", mcpLimiter, async (req, res) => {
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

// Unknown /api/* routes return a JSON 404 instead of falling through to the
// SPA catch-all (which would serve index.html). Non-API paths pass through.
app.use(notFoundHandler);

// Serve built frontend in production (`npm start` or compiled `node dist/server/index.js`)
const distDir = resolveDistDir();
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
  initPlugins(db).catch((err) => logger.warn({ err }, "plugin init failed"));
  logger.info({ port: PORT, path: "/ws" }, "WebSocket available");
  logger.info({ port: PORT, path: "/mcp" }, "MCP (Streamable HTTP) available");
  // Backfill milestone daily stats so the dashboard has data immediately
  try {
    const backfilled = backfillMilestoneDailyStats(db);
    if (backfilled > 0) logger.info({ count: backfilled }, "Backfilled daily stats for milestones");
  } catch (err) {
    logger.error({ err }, "backfillMilestoneDailyStats failed — continuing without backfill");
  }
});

export { app, db, server };
