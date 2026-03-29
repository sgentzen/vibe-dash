import { useEffect } from "react";
import "./App.css";
import { useAppState, useAppDispatch } from "./store";
import { useApi } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePolling } from "./hooks/usePolling";
import { TopBar } from "./components/TopBar";
import { ProjectList } from "./components/ProjectList";
import { TaskBoard } from "./components/TaskBoard";
import { AgentFeed } from "./components/AgentFeed";
import { AlertBanner } from "./components/AlertBanner";

export function App() {
  const dispatch = useAppDispatch();
  const { blockers } = useAppState();
  const api = useApi();

  useWebSocket();
  usePolling();

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData(retries = 10, delayMs = 500) {
      for (let i = 0; i < retries; i++) {
        if (cancelled) return;
        try {
          const [stats, projects, sprints, tasks, agents, activity, blockerList] =
            await Promise.all([
              api.getStats(),
              api.getProjects(),
              api.getSprints(),
              api.getTasks(),
              api.getAgents(),
              api.getActivity(),
              api.getBlockers(),
            ]);
          if (cancelled) return;
          dispatch({ type: "SET_STATS", payload: stats });
          dispatch({ type: "SET_PROJECTS", payload: projects });
          dispatch({ type: "SET_SPRINTS", payload: sprints });
          dispatch({ type: "SET_TASKS", payload: tasks });
          dispatch({ type: "SET_AGENTS", payload: agents });
          dispatch({ type: "SET_ACTIVITY", payload: activity });
          dispatch({ type: "SET_BLOCKERS", payload: blockerList });
          return;
        } catch {
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
        }
      }
    }

    loadInitialData();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app">
      <TopBar />
      <div className="main-content">
        <ProjectList />
        <TaskBoard />
        <AgentFeed />
      </div>
      {blockers.length > 0 && <AlertBanner />}
    </div>
  );
}
