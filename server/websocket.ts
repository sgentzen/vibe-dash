import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { parse as parseUrl } from "url";
import type { WsEvent } from "./types.js";
import { logger } from "./logger.js";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): WebSocketServer {
  // noServer: true — we own the upgrade event and call handleUpgrade only after routing check
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket client error");
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const { pathname } = parseUrl(req.url ?? "", true);
    if (pathname !== "/ws") return;

    wss!.handleUpgrade(req, socket, head, (ws) => wss!.emit("connection", ws, req));
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
