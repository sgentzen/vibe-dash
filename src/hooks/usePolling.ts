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
      try {
        const [stats, projects, sprints, tasks, agents, activity, blockers] =
          await Promise.all([
            api.getStats(),
            api.getProjects(),
            api.getSprints(),
            api.getTasks(),
            api.getAgents(),
            api.getActivity(),
            api.getBlockers(),
          ]);
        dispatch({ type: "SET_STATS", payload: stats });
        dispatch({ type: "SET_PROJECTS", payload: projects });
        dispatch({ type: "SET_SPRINTS", payload: sprints });
        dispatch({ type: "SET_TASKS", payload: tasks });
        dispatch({ type: "SET_AGENTS", payload: agents });
        dispatch({ type: "SET_ACTIVITY", payload: activity });
        dispatch({ type: "SET_BLOCKERS", payload: blockers });
      } catch {
        // server may be temporarily unreachable — skip this cycle
      }
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
        timer.current = setInterval(poll, POLL_INTERVAL_MS);
      }
    });

    return () => {
      cancelled = true;
      if (timer.current !== null) clearInterval(timer.current);
    };
  }, [api, dispatch]);
}
