import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type Database from "better-sqlite3";
import { openDb, backfillMilestoneDailyStats, SchemaTooNewError } from "./db/index.js";
import { resolveDbPath } from "./db/path.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes/index.js";
import { otlpLimiter } from "./routes/otlp.js";
import { errorHandler, notFoundHandler } from "./routes/middleware.js";
import { logger } from "./logger.js";
import { syncTranscripts } from "./ingest/transcripts/sync.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/server.js";
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
// Three-way ordering for /v1/metrics, and it is not obvious, so each piece is
// spelled out:
//
// 1. otlpLimiter runs FIRST, ahead of even this path's own body parser. An
//    unauthenticated local endpoint that writes to the cost table is bound by
//    two things: the size cap below and this limiter. express.json() buffers
//    and JSON.parses the ENTIRE body before any downstream middleware runs at
//    all, so a parser mounted ahead of the limiter would pay that cost —
//    buffering and parsing up to 1mb — for every request, including every one
//    the limiter exists to reject. Put the limiter first, and only the
//    requests it actually admits ever reach a parse.
// 2. The 1mb parser for this path runs second, still ahead of the global one
//    below. OTLP metric batches are larger than a normal API call, and
//    body-parser marks a request as parsed once it runs, so a second parser
//    mounted after this one (the global 256kb line) is a no-op for this path
//    — mounting the 1mb parser only inside the route, instead of here ahead
//    of the global line, would silently leave the effective cap at 256kb.
// 3. The global 256kb parser runs last and never sees a /v1/metrics request,
//    both because of (2) and because Express only descends into a later
//    app.use() once the request is still unhandled.
// Mounted with app.use rather than on the route, so the limiter covers every
// method on this path rather than POST alone. Only POST is registered, so the
// practical effect is that a GET or PUT here spends rate-limit budget before
// reaching the 404. That is deliberate: the point of moving the limiter ahead
// of the parser is to reject a flood before its body is read, and a flood is
// not obliged to use the method we expect.
app.use("/v1/metrics", otlpLimiter);
app.use("/v1/metrics", express.json({ limit: "1mb" }));
app.use(express.json({ limit: "256kb" }));

function openDbOrExit(): Database.Database {
  try {
    return openDb(DB_PATH);
  } catch (err) {
    if (err instanceof SchemaTooNewError) {
      logger.error(
        { DB_PATH, unknownMigrations: err.unknownMigrations },
        `${err.message} — aborting startup`
      );
    } else {
      logger.error({ err, DB_PATH }, "Failed to open database — aborting startup");
    }
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
  logger.info({ port: PORT, path: "/ws" }, "WebSocket available");
  logger.info({ port: PORT, path: "/mcp" }, "MCP (Streamable HTTP) available");
  // Backfill milestone daily stats so the dashboard has data immediately
  try {
    const backfilled = backfillMilestoneDailyStats(db);
    if (backfilled > 0) logger.info({ count: backfilled }, "Backfilled daily stats for milestones");
  } catch (err) {
    logger.error({ err }, "backfillMilestoneDailyStats failed — continuing without backfill");
  }

  // Backgrounded deliberately: the first run on a machine with a long Claude
  // Code history walks every transcript, and that must never delay the server
  // becoming available. syncTranscripts yields to the event loop between files,
  // which is what makes that true rather than aspirational — every step of the
  // work itself is synchronous. A failure here is logged and otherwise ignored,
  // exactly like the backfill above: cost ingestion is best-effort and never
  // degrades the running server.
  syncTranscripts(db)
    .then((result) => {
      if (result.recordsIngested > 0) {
        logger.info(result, "Ingested Claude Code transcript usage");
      }
    })
    .catch((err) => logger.warn({ err }, "transcript ingestion failed — continuing"));

  // A steady-state pass costs time proportional to new bytes, not to the number
  // of transcripts on disk, because each file resumes from its recorded byte
  // offset. unref() keeps this timer from holding the process open, so the
  // server still exits cleanly on SIGINT.
  const INGEST_INTERVAL_MS = 60_000;
  const ingestTimer = setInterval(() => {
    syncTranscripts(db).catch((err) => logger.warn({ err }, "periodic transcript scan failed"));
  }, INGEST_INTERVAL_MS);
  ingestTimer.unref();
});

export { app, db, server };
