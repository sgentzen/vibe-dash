import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { parse as parseUrl } from "url";
import type Database from "better-sqlite3";
import type { WsEvent } from "./types.js";
import { logger } from "./logger.js";
import { hashApiKey, isAuthEnabled } from "./auth.js";
import { createHash } from "crypto";
import { getUserByKeyHash } from "./db/users.js";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server, db: Database.Database): WebSocketServer {
  // noServer: true — we own the upgrade event and call handleUpgrade only after auth passes
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket client error");
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname, query } = parseUrl(req.url ?? "", true);
    if (pathname !== "/ws") return;

    const accept = () => wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit("connection", ws, req));
    const reject = (reason: string) => {
      logger.warn({ reason }, "WebSocket upgrade rejected");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
    };

    // Auth disabled in local-only mode (no users registered)
    if (!isAuthEnabled(db)) {
      accept();
      return;
    }

    const rawToken = query.token;
    const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
    if (!token) { reject("no token"); return; }

    // Try HMAC hash first; fall back to legacy SHA-256
    let user = getUserByKeyHash(db, hashApiKey(token));
    if (!user) {
      const legacyHash = createHash("sha256").update(token).digest("hex");
      user = getUserByKeyHash(db, legacyHash);
    }
    if (!user) { reject("invalid token"); return; }

    accept();
  });

  return wss;
}

export function broadcast(event: WsEvent): void {
  if (!wss) return;
  const data = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}
