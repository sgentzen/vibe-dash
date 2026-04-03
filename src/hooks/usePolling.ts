import { useEffect, useRef } from "react";
import { useAppDispatch } from "../store";
import { useApi } from "./useApi";

const POLL_INTERVAL_MS = 3000;
const STARTUP_PROBE_MS = 1000;

/**
 * Polls the server periodically so the UI picks up changes made
 * outside the WebSocket path (e.g. stdio MCP writes directly to SQLite).
 * Waits for the server to become reachable before starting the interval.
 */
export function usePolling() {
  const dispatch = useAppDispatch();
  const api = useApi();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const results = await Promise.allSettled([
        api.getStats(),
        api.getProjects(),
        api.getSprints(),
        api.getTasks(),
        api.getAgents(),
        api.getActivity(),
        api.getBlockers(),
      ]);
      const [stats, projects, sprints, tasks, agents, activity, blockers] = results;
      if (stats.status === "fulfilled") dispatch({ type: "SET_STATS", payload: stats.value });
      if (projects.status === "fulfilled") dispatch({ type: "SET_PROJECTS", payload: projects.value });
      if (sprints.status === "fulfilled") dispatch({ type: "SET_SPRINTS", payload: sprints.value });
      if (tasks.status === "fulfilled") dispatch({ type: "SET_TASKS", payload: tasks.value });
      if (agents.status === "fulfilled") dispatch({ type: "SET_AGENTS", payload: agents.value });
      if (activity.status === "fulfilled") dispatch({ type: "SET_ACTIVITY", payload: activity.value });
      if (blockers.status === "fulfilled") dispatch({ type: "SET_BLOCKERS", payload: blockers.value });

      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.warn(`[usePolling] ${failures.length}/7 endpoints failed`, failures.map((f) => (f as PromiseRejectedResult).reason));
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
