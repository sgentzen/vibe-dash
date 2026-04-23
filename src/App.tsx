import { useEffect, useState } from "react";
import "./App.css";
import { useAppState, useAppDispatch } from "./store";
import { useApi } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePolling } from "./hooks/usePolling";
import { TopBar } from "./components/TopBar";
import { ProjectList } from "./components/ProjectList";
import { TaskBoard } from "./components/TaskBoard";
import { AgentDashboard } from "./components/AgentDashboard";
import { TaskListView } from "./components/TaskListView";
import { DashboardView } from "./components/DashboardView";
import { TimelineView } from "./components/TimelineView";
import { ActivityStreamView } from "./components/ActivityStreamView";
import { OrchestrationView } from "./components/orchestration/OrchestrationView";
import { WorktreeView } from "./components/WorktreeView";
import { ExecutiveView } from "./components/ExecutiveView";
import { AgentFeed } from "./components/AgentFeed";
import { AlertBanner } from "./components/AlertBanner";
import { OnboardingWizard } from "./components/OnboardingWizard";

export function App() {
  const dispatch = useAppDispatch();
  const { blockers, theme, activeView, fileConflicts } = useAppState();
  const api = useApi();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useWebSocket();
  usePolling();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // Restore custom accent color
    const accent = localStorage.getItem("vibe-dash-accent");
    if (accent) {
      document.documentElement.style.setProperty("--accent-user", accent);
      document.documentElement.setAttribute("data-accent", "true");
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData(retries = 10, delayMs = 500) {
      for (let i = 0; i < retries; i++) {
        if (cancelled) return;
        try {
          const [stats, projects, milestones, tasks, agents, activity, blockerList] =
            await Promise.all([
              api.getStats(),
              api.getProjects(),
              api.getMilestones(),
              api.getTasks(),
              api.getAgents(),
              api.getActivity(),
              api.getBlockers(),
            ]);
          if (cancelled) return;
          dispatch({ type: "SET_STATS", payload: stats });
          dispatch({ type: "SET_PROJECTS", payload: projects });
          dispatch({ type: "SET_MILESTONES", payload: milestones });
          dispatch({ type: "SET_TASKS", payload: tasks });
          dispatch({ type: "SET_AGENTS", payload: agents });
          dispatch({ type: "SET_ACTIVITY", payload: activity });
          dispatch({ type: "SET_BLOCKERS", payload: blockerList });

          // Load tags and milestones for all projects
          const [allTags, allMilestones] = await Promise.all([
            Promise.all(projects.map((p) => api.getTags(p.id))).then((r) => r.flat()),
            Promise.all(projects.map((p) => api.getMilestones(p.id))).then((r) => r.flat()),
          ]);
          dispatch({ type: "SET_TAGS", payload: allTags });
          dispatch({ type: "SET_MILESTONES", payload: allMilestones });

          // Load task tags and dependencies in bulk (one request per project instead of N per task)
          const [taskTagPairs, allDeps] = await Promise.all([
            Promise.all(projects.map((p) => api.getProjectTaskTags(p.id))).then((r) => r.flat()),
            Promise.all(projects.map((p) => api.getProjectTaskDependencies(p.id))).then((r) => r.flat()),
          ]);
          const tagMap: Record<string, string[]> = {};
          for (const { task_id, tag } of taskTagPairs) {
            (tagMap[task_id] ??= []).push(tag.id);
          }
          dispatch({ type: "SET_TASK_TAG_MAP", payload: tagMap });

          const depsMap: Record<string, string[]> = {};
          for (const d of allDeps) {
            (depsMap[d.task_id] ??= []).push(d.depends_on_task_id);
          }
          dispatch({ type: "SET_TASK_DEPS_MAP", payload: depsMap });

          // Load notifications, file conflicts, and worktrees
          const [notifs, unread, conflicts, worktrees] = await Promise.all([
            api.getNotifications(50),
            api.getUnreadCount(),
            api.getFileConflicts(),
            api.getWorktrees(),
          ]);
          dispatch({ type: "SET_NOTIFICATIONS", payload: notifs });
          dispatch({ type: "SET_UNREAD_COUNT", payload: unread });
          dispatch({ type: "SET_FILE_CONFLICTS", payload: conflicts });
          dispatch({ type: "SET_WORKTREES", payload: worktrees });

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
      const [stats, projects, milestones, tasks] = await Promise.all([
        api.getStats(),
        api.getProjects(),
        api.getMilestones(),
        api.getTasks(),
      ]);
      dispatch({ type: "SET_STATS", payload: stats });
      dispatch({ type: "SET_PROJECTS", payload: projects });
      dispatch({ type: "SET_MILESTONES", payload: milestones });
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
        {activeView === "orchestration" ? <OrchestrationView /> : activeView === "board" ? <TaskBoard /> : activeView === "agents" ? <AgentDashboard /> : activeView === "list" ? <TaskListView /> : activeView === "dashboard" ? <DashboardView /> : activeView === "timeline" ? <TimelineView /> : activeView === "worktrees" ? <WorktreeView /> : activeView === "executive" ? <ExecutiveView /> : <ActivityStreamView />}
        <AgentFeed />
      </div>
      {(blockers.length > 0 || fileConflicts.length > 0) && <AlertBanner />}
      {loaded && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
    </div>
  );
}
