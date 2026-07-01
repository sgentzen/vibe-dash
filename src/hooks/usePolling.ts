import { useEffect, useRef } from "react";
import { useAppDispatch, useNavigationState } from "../store";
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
  const { activeView, fleetPreset } = useNavigationState();
  const api = useApi();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeViewRef = useRef(activeView);
  const fleetPresetRef = useRef(fleetPreset);
  activeViewRef.current = activeView;
  fleetPresetRef.current = fleetPreset;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const view = activeViewRef.current;
      const preset = fleetPresetRef.current;

      // Always fetch core data
      const promises: Promise<unknown>[] = [
        api.getStats().then((v) => dispatch({ type: "SET_STATS", payload: v })),
        api.getProjects().then((v) => dispatch({ type: "SET_PROJECTS", payload: v })),
        api.getBlockers().then((v) => dispatch({ type: "SET_BLOCKERS", payload: v })),
      ];

      // Tasks + milestones needed for board view and most fleet presets
      // (skip only when in fleet/agents — a pure-agent preset doesn't need tasks)
      const skipTasks = view === "fleet" && preset === "agents";
      if (!skipTasks) {
        promises.push(
          api.getTasks().then((v) => dispatch({ type: "SET_TASKS", payload: v })),
          api.getMilestones().then((v) => dispatch({ type: "SET_MILESTONES", payload: v })),
        );
      }

      promises.push(
        api.getAgents().then((v) => dispatch({ type: "SET_AGENTS", payload: v })),
      );

      // Activity needed for the feed view and the agents preset
      if (view === "feed" || (view === "fleet" && preset === "agents")) {
        promises.push(
          api.getActivity().then((v) => dispatch({ type: "SET_ACTIVITY", payload: v })),
        );
      }

      // Worktrees needed when the agents preset is showing them (stdio MCP writes
      // bypass WebSocket, so polling is the only path that reflects worktree CRUD).
      if (view === "fleet" && preset === "agents") {
        promises.push(
          api.getWorktrees().then((v) => dispatch({ type: "SET_WORKTREES", payload: v })),
        );
      }

      const results = await Promise.allSettled(promises);
      const failures = results.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        // Interpolated values are numeric counts; template literal is fully resolved
        // before console.warn is called, so format-specifier injection cannot occur.
        // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
        console.warn(`[usePolling] ${failures.length}/${results.length} endpoints failed`, failures.map((f) => (f).reason));
      }

      dispatch({ type: "INCREMENT_POLL_GENERATION" });
    }

    async function waitForServer() {
      while (!cancelled) {
        try {
          await fetch("/api/health");
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
