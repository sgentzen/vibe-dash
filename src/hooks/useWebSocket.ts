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
      const ticketParam = ticket ? `?ticket=${encodeURIComponent(ticket)}` : "";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws${ticketParam}`);
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
