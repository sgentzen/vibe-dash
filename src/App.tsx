import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { useDataState, useNavigationState, useNotificationState, useAppDispatch } from "./store";
import { useApi, getStoredApiKey } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePolling } from "./hooks/usePolling";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
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
import { LoginView } from "./components/LoginView";
import { ProjectContextChip } from "./components/ProjectContextChip";
import { CommandPalette } from "./components/CommandPalette";

export function App() {
  const dispatch = useAppDispatch();
  const { blockers } = useDataState();
  const { theme, activeView, isAuthenticated, authEnabled, rightRailCollapsed } = useNavigationState();
  const { fileConflicts } = useNotificationState();
  const api = useApi();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const gKeyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gKeyPending = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const clearSearch = useCallback(() => {
    dispatch({ type: "SET_SEARCH_QUERY", payload: "" });
  }, [dispatch]);

  useKeyboardShortcuts({ searchInputRef, onClearSearch: clearSearch });
  useWebSocket();
  usePolling();

  // Check auth status on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await api.getAuthStatus();
        if (!status.auth_enabled) {
          dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: true, authEnabled: false } });
          setAuthChecked(true);
          return;
        }
        // Auth is enabled — validate stored key (if any)
        const storedKey = getStoredApiKey();
        if (storedKey) {
          try {
            const user = await api.validateApiKey(storedKey);
            dispatch({ type: "SET_AUTH", payload: { currentUser: user, isAuthenticated: true, authEnabled: true } });
          } catch {
            // Key invalid or expired — prompt login
            dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: false, authEnabled: true } });
          }
        } else {
          dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: false, authEnabled: true } });
        }
      } catch {
        // Server unreachable — treat as local-only; polling will retry data loading
        dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: true, authEnabled: false } });
      }
      setAuthChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-collapse right rail on views where it would obscure content.
  // Uses SET_RIGHT_RAIL_COLLAPSED (not TOGGLE) so it doesn't write to localStorage
  // and doesn't permanently override the user's stored preference.
  useEffect(() => {
    if (activeView === "timeline" || activeView === "executive" || activeView === "agents") {
      dispatch({ type: "SET_RIGHT_RAIL_COLLAPSED", payload: true });
    }
  }, [activeView, dispatch]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isEditable =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      // ⌘⇧K (or Ctrl+Shift+K) opens command palette
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      if (isEditable) return;

      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (gKeyTimer.current !== null) clearTimeout(gKeyTimer.current);
        gKeyPending.current = true;
        gKeyTimer.current = setTimeout(() => { gKeyPending.current = false; gKeyTimer.current = null; }, 1000);
        return;
      }

      if (gKeyPending.current) {
        gKeyPending.current = false;
        const viewMap: Record<string, typeof activeView> = {
          b: "board",
          a: "agents",
          l: "list",
          d: "dashboard",
          t: "timeline",
          v: "activity",
        };
        const view = viewMap[e.key];
        if (view) dispatch({ type: "SET_ACTIVE_VIEW", payload: view });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (gKeyTimer.current !== null) {
        clearTimeout(gKeyTimer.current);
        gKeyTimer.current = null;
      }
    };
  }, [dispatch]);

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

  // Show nothing until auth is resolved
  if (!authChecked) return null;

  // Show login when auth is enabled but user is not authenticated
  if (authEnabled && !isAuthenticated) return <LoginView />;

  return (
    <div className="app">
      <TopBar onCommandPalette={() => setCommandPaletteOpen(true)} searchInputRef={searchInputRef} />
      <div className={`main-content${rightRailCollapsed ? " rail-collapsed" : ""}`}>
        <ProjectList />
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "6px 16px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
              gap: "8px",
              minHeight: "32px",
            }}
          >
            <ProjectContextChip />
          </div>
          {activeView === "orchestration" ? <OrchestrationView /> : activeView === "board" ? <TaskBoard /> : activeView === "agents" ? <AgentDashboard /> : activeView === "list" ? <TaskListView /> : activeView === "dashboard" ? <DashboardView /> : activeView === "timeline" ? <TimelineView /> : activeView === "worktrees" ? <WorktreeView /> : activeView === "executive" ? <ExecutiveView /> : <ActivityStreamView />}
        </div>
        {rightRailCollapsed ? (
          <aside
            style={{
              background: "var(--bg-secondary)",
              borderLeft: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingTop: "10px",
              overflow: "hidden",
            }}
          >
            <button
              onClick={() => dispatch({ type: "TOGGLE_RIGHT_RAIL" })}
              title="Expand agent feed"
              aria-label="Expand agent feed"
              style={{
                background: "transparent",
                border: "none",
                padding: "4px",
                cursor: "pointer",
                color: "var(--text-muted)",
                fontSize: "14px",
                lineHeight: 1,
                borderRadius: "3px",
              }}
            >
              ‹
            </button>
          </aside>
        ) : (
          <AgentFeed onCollapse={() => dispatch({ type: "TOGGLE_RIGHT_RAIL" })} />
        )}
      </div>
      {(blockers.length > 0 || fileConflicts.length > 0) && <AlertBanner />}
      {loaded && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      {commandPaletteOpen && (
        <CommandPalette onClose={() => setCommandPaletteOpen(false)} />
      )}
    </div>
  );
}
