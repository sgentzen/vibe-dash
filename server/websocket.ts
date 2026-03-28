import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { WsEvent } from "./types.js";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.on("error", (err) => {
      console.error("WebSocket client error:", err.message);
    });
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
