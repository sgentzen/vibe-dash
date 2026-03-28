import express from "express";
import { createServer } from "http";
import { openDb } from "./db.js";
import { initWebSocket } from "./websocket.js";
import { createRouter } from "./routes.js";

const PORT = parseInt(process.env.PORT ?? "3001");
const DB_PATH = process.env.DB_PATH ?? "vibe-dash.db";

const app = express();
app.use(express.json());

const db = openDb(DB_PATH);
app.use(createRouter(db));

const server = createServer(app);
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`Vibe Dash server running on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});

export { app, db, server };
