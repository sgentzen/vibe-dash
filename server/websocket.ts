import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "node:http";
import { parse as parseUrl } from "node:url";
import type { WsEvent } from "./types.js";
import { logger } from "./logger.js";
import { isUpgradeAllowed, type AllowedNetwork } from "./security/origin.js";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server, network: AllowedNetwork): WebSocketServer {
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

    // WebSockets are exempt from same-origin policy for reading responses, so
    // this is the one place SEC-1's Host/Origin check has to run explicitly —
    // Express's app.use() middleware never sees an upgrade request at all.
    // See server/security/origin.ts.
    if (!isUpgradeAllowed(req, network)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

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
