import { useEffect, useState } from "react";
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
import { OnboardingWizard } from "./components/OnboardingWizard";

export function App() {
  const dispatch = useAppDispatch();
  const { blockers, theme } = useAppState();
  const api = useApi();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useWebSocket();
  usePolling();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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

          // Load tags for all projects
          const allTags = (await Promise.all(
            projects.map((p) => api.getTags(p.id))
          )).flat();
          dispatch({ type: "SET_TAGS", payload: allTags });

          // Load task tags for all tasks
          const taskTagEntries = await Promise.all(
            tasks.map(async (t) => {
              const tags = await api.getTaskTags(t.id);
              return [t.id, tags.map((tag) => tag.id)] as [string, string[]];
            })
          );
          const tagMap: Record<string, string[]> = {};
          for (const [taskId, tagIds] of taskTagEntries) {
            if (tagIds.length > 0) tagMap[taskId] = tagIds;
          }
          dispatch({ type: "SET_TASK_TAG_MAP", payload: tagMap });

          // Show onboarding wizard on first run (no projects)
          if (projects.length === 0) {
            setShowOnboarding(true);
          }
          setLoaded(true);
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

  async function handleOnboardingComplete() {
    setShowOnboarding(false);
    // Reload data to reflect newly created project/task
    try {
      const [stats, projects, sprints, tasks] = await Promise.all([
        api.getStats(),
        api.getProjects(),
        api.getSprints(),
        api.getTasks(),
      ]);
      dispatch({ type: "SET_STATS", payload: stats });
      dispatch({ type: "SET_PROJECTS", payload: projects });
      dispatch({ type: "SET_SPRINTS", payload: sprints });
      dispatch({ type: "SET_TASKS", payload: tasks });
      if (projects.length > 0) {
        dispatch({ type: "SELECT_PROJECT", payload: projects[0].id });
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="app">
      <TopBar />
      <div className="main-content">
        <ProjectList />
        <TaskBoard />
        <AgentFeed />
      </div>
      {blockers.length > 0 && <AlertBanner />}
      {loaded && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
    </div>
  );
}
