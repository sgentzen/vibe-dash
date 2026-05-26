import { useEffect, useRef } from "react";
import { useAppDispatch } from "../store";
import type { WsEvent } from "../types";
import { getWsTicket } from "./useApi";

const RECONNECT_DELAY_MS = 2000;

export function useWebSocket() {
  const dispatch = useAppDispatch();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  useEffect(() => {
    unmounted.current = false;

    async function connect() {
      if (unmounted.current) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ticket = await getWsTicket();
      // Restrict ticket to an opaque token charset so it cannot inject extra URL components.
      const safeTicket = ticket && /^[A-Za-z0-9_-]+$/.test(ticket) ? ticket : "";
      const ticketParam = safeTicket ? `?ticket=${encodeURIComponent(safeTicket)}` : "";
      const wsUrl = new URL(`${protocol}//${window.location.host}/ws${ticketParam}`);
      const ws = new WebSocket(wsUrl.toString());
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data: WsEvent = JSON.parse(event.data as string);
          dispatch({ type: "WS_EVENT", payload: data });
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!unmounted.current) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current !== null) {
        clearTimeout(reconnectTimer.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [dispatch]);
}
