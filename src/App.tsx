import { useEffect } from "react";
import "./App.css";
import { useAppState, useAppDispatch } from "./store";
import { useApi } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
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

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [stats, projects, tasks, agents, activity, blockerList] =
          await Promise.all([
            api.getStats(),
            api.getProjects(),
            api.getTasks(),
            api.getAgents(),
            api.getActivity(),
            api.getBlockers(),
          ]);
        dispatch({ type: "SET_STATS", payload: stats });
        dispatch({ type: "SET_PROJECTS", payload: projects });
        dispatch({ type: "SET_TASKS", payload: tasks });
        dispatch({ type: "SET_AGENTS", payload: agents });
        dispatch({ type: "SET_ACTIVITY", payload: activity });
        dispatch({ type: "SET_BLOCKERS", payload: blockerList });
      } catch {
        // silently fail — WS will keep data fresh
      }
    }

    loadInitialData();
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
