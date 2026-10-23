import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { WsEvent } from "./types.js";
import { logger } from "./logger.js";
import { isUpgradeAllowed, type AllowedNetwork } from "./security/origin.js";

let wss: WebSocketServer | null = null;

/**
 * True only for an origin-form `/ws` target, with or without a query string.
 * Deliberately a plain string comparison: this runs on raw request-target text
 * before any trust check, and legacy url.parse throws URIError on inputs such
 * as `//%zz@h/ws`, which would escape the upgrade listener and kill the process.
 */
function isWsPath(target: string | undefined): boolean {
  if (!target) return false;
  const queryStart = target.indexOf("?");
  return (queryStart === -1 ? target : target.slice(0, queryStart)) === "/ws";
}

function refuseUpgrade(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function initWebSocket(server: Server, network: AllowedNetwork): WebSocketServer {
  // noServer: true — we own the upgrade event and call handleUpgrade only after routing check
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket client error");
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    // Node removes its own socket error handler before emitting 'upgrade', so
    // a peer reset while we reply below would otherwise be an unhandled
    // 'error' event on the shared process. Detached again on handoff, where
    // ws installs its own handler for the connection's lifetime.
    const onUpgradeSocketError = (err: Error) => {
      logger.warn({ err }, "WebSocket upgrade socket error");
    };
    socket.on("error", onUpgradeSocketError);

    // Once an 'upgrade' listener exists Node no longer closes unhandled
    // upgrade sockets itself, so every declined request must be answered and
    // destroyed here rather than left open.
    if (!isWsPath(req.url)) {
      refuseUpgrade(socket, "404 Not Found");
      return;
    }

    // WebSockets are exempt from same-origin policy for reading responses, so
    // this is the one place SEC-1's Host/Origin check has to run explicitly —
    // Express's app.use() middleware never sees an upgrade request at all.
    // See server/security/origin.ts.
    if (!isUpgradeAllowed(req, network)) {
      refuseUpgrade(socket, "403 Forbidden");
      return;
    }

    socket.off("error", onUpgradeSocketError);
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
