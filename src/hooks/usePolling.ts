import { useEffect, useRef } from "react";
import { useAppDispatch, useAppState } from "../store";
import { useApi } from "./useApi";

const POLL_INTERVAL_MS = 3000;
const STARTUP_PROBE_MS = 1000;

/**
 * Polls the server periodically so the UI picks up changes made
 * outside the WebSocket path (e.g. stdio MCP writes directly to SQLite).
 * Waits for the server to become reachable before starting the interval.
 *
 * View-aware: always polls stats + projects; other data only when relevant
 * to the active view, reducing unnecessary requests from 7 to 3-5.
 */
export function usePolling() {
  const dispatch = useAppDispatch();
  const { activeView } = useAppState();
  const api = useApi();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const view = activeViewRef.current;

      // Always fetch core data
      const promises: Promise<unknown>[] = [
        api.getStats().then((v) => dispatch({ type: "SET_STATS", payload: v })),
        api.getProjects().then((v) => dispatch({ type: "SET_PROJECTS", payload: v })),
        api.getBlockers().then((v) => dispatch({ type: "SET_BLOCKERS", payload: v })),
      ];

      // Tasks + milestones needed for board, list, dashboard, timeline views
      if (view !== "agents") {
        promises.push(
          api.getTasks().then((v) => dispatch({ type: "SET_TASKS", payload: v })),
          api.getMilestones().then((v) => dispatch({ type: "SET_MILESTONES", payload: v })),
        );
      }

      // Agents needed for board, agents, dashboard views
      if (view !== "list" && view !== "timeline") {
        promises.push(
          api.getAgents().then((v) => dispatch({ type: "SET_AGENTS", payload: v })),
        );
      }

      // Activity needed for activity, agents, dashboard views
      if (view === "activity" || view === "agents" || view === "dashboard") {
        promises.push(
          api.getActivity().then((v) => dispatch({ type: "SET_ACTIVITY", payload: v })),
        );
      }

      const results = await Promise.allSettled(promises);
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(`[usePolling] ${failures.length}/${results.length} endpoints failed`, failures.map((f) => (f as PromiseRejectedResult).reason));
      }

      dispatch({ type: "INCREMENT_POLL_GENERATION" });
    }

    async function waitForServer() {
      while (!cancelled) {
        try {
          await fetch("/api/stats");
          return true;
        } catch {
          await new Promise((r) => setTimeout(r, STARTUP_PROBE_MS));
        }
      }
      return false;
    }

    waitForServer().then((ready) => {
      if (ready && !cancelled) {
        poll();
        timer.current = setInterval(poll, POLL_INTERVAL_MS);
      }
    });

    return () => {
      cancelled = true;
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, [api, dispatch]);
}
