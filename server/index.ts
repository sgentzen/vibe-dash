import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { openDb } from "./db.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpServer } from "./mcp/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT ?? "3001");
const DB_PATH = process.env.VIBE_DASH_DB ?? path.join(PROJECT_ROOT, "vibe-dash.db");

const app = express();
app.use(express.json());

const db = openDb(DB_PATH);
app.use(createRouter(db));

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

// Serve built frontend in production (npm start)
const distDir = path.join(PROJECT_ROOT, "dist");
app.use(express.static(distDir));
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const server = createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`Vibe Dash running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`MCP SSE at http://localhost:${PORT}/sse`);
});

export { app, db, server };
