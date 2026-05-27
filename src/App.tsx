import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { useDataState, useNavigationState, useNotificationState, useAppDispatch } from "./store";
import { useApi, getStoredApiKey, ApiError } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePolling } from "./hooks/usePolling";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { getInitialRightRailCollapsed } from "./state/setReducer";
import { TopBar } from "./components/TopBar";
import { ProjectList } from "./components/ProjectList";
import { TaskBoard } from "./components/TaskBoard";
import { ActivityStreamView } from "./components/ActivityStreamView";
import { FleetView } from "./components/fleet/FleetView";
import { AgentFeed } from "./components/AgentFeed";
import { AlertBanner } from "./components/AlertBanner";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { LoginView } from "./components/LoginView";
import { ProjectContextChip } from "./components/ProjectContextChip";
import { CommandPalette } from "./components/CommandPalette";

export function App() {
  const dispatch = useAppDispatch();
  const { blockers } = useDataState();
  const { theme, activeView, fleetPreset, isAuthenticated, authEnabled, rightRailCollapsed } = useNavigationState();
  const { fileConflicts, loadError } = useNotificationState();
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
        const teamMode = status.team_mode ?? false;
        if (!status.auth_enabled) {
          dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: true, authEnabled: false, teamMode } });
          setAuthChecked(true);
          return;
        }
        // Auth is enabled — validate stored key (if any)
        const storedKey = getStoredApiKey();
        if (storedKey) {
          try {
            const user = await api.validateApiKey(storedKey);
            dispatch({ type: "SET_AUTH", payload: { currentUser: user, isAuthenticated: true, authEnabled: true, teamMode } });
          } catch {
            // Key invalid or expired — prompt login
            dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: false, authEnabled: true, teamMode } });
          }
        } else {
          dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: false, authEnabled: true, teamMode } });
        }
      } catch {
        // Server unreachable — treat as local-only; polling will retry data loading
        dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: true, authEnabled: false, teamMode: false } });
      }
      setAuthChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-collapse right rail on views where it would obscure content.
  // Uses SET_RIGHT_RAIL_COLLAPSED (not TOGGLE) so it doesn't write to localStorage
  // and doesn't permanently override the user's stored preference.
  useEffect(() => {
    if (activeView === "fleet" && (fleetPreset === "timeline" || fleetPreset === "agents")) {
      dispatch({ type: "SET_RIGHT_RAIL_COLLAPSED", payload: true });
    } else {
      // Restore the user's persisted preference when leaving Timeline,
      // so the rail doesn't stay hidden after a one-off visit.
      dispatch({ type: "SET_RIGHT_RAIL_COLLAPSED", payload: getInitialRightRailCollapsed() });
    }
  }, [activeView, fleetPreset, dispatch]);

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
          f: "fleet",
          b: "board",
          v: "feed",
        };
        const view = viewMap[e.key];
        if (view) {
          dispatch({ type: "SET_ACTIVE_VIEW", payload: view });
          return;
        }
        const presetMap: Record<string, "overview" | "hotspots" | "agents" | "timeline"> = {
          o: "overview",
          h: "hotspots",
          a: "agents",
          t: "timeline",
        };
        const preset = presetMap[e.key];
        if (preset) {
          dispatch({ type: "SET_ACTIVE_VIEW", payload: "fleet" });
          dispatch({ type: "SET_FLEET_PRESET", payload: preset });
        }
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

    // Atomic load: gather everything first, dispatch only once on success.
    // This prevents partially-failed retries from clobbering previously-good
    // state with empty arrays while the server is mid-restart.
    async function attemptLoad(): Promise<boolean> {
      const [stats, projects, tasks, agents, activity, blockerList] = await Promise.all([
        api.getStats(), api.getProjects(), api.getTasks(),
        api.getAgents(), api.getActivity(), api.getBlockers(),
      ]);
      if (cancelled) return true;

      const [allTags, allMilestones, taskTagPairs, allDeps, notifs, unread, worktrees] = await Promise.all([
        Promise.all(projects.map((p) => api.getTags(p.id))).then((r) => r.flat()),
        Promise.all(projects.map((p) => api.getMilestones(p.id))).then((r) => r.flat()),
        Promise.all(projects.map((p) => api.getProjectTaskTags(p.id))).then((r) => r.flat()),
        Promise.all(projects.map((p) => api.getProjectTaskDependencies(p.id))).then((r) => r.flat()),
        api.getNotifications(50), api.getUnreadCount(), api.getWorktrees(),
      ]);
      if (cancelled) return true;

      const tagMap: Record<string, string[]> = {};
      for (const { task_id, tag } of taskTagPairs) {
        const list = tagMap[task_id] ?? [];
        list.push(tag.id);
        tagMap[task_id] = list;
      }
      const depsMap: Record<string, string[]> = {};
      for (const d of allDeps) {
        const list = depsMap[d.task_id] ?? [];
        list.push(d.depends_on_task_id);
        depsMap[d.task_id] = list;
      }

      // Single atomic dispatch sequence — only runs after both batches succeed.
      dispatch({ type: "SET_STATS", payload: stats });
      dispatch({ type: "SET_PROJECTS", payload: projects });
      dispatch({ type: "SET_MILESTONES", payload: allMilestones });
      dispatch({ type: "SET_TASKS", payload: tasks });
      dispatch({ type: "SET_AGENTS", payload: agents });
      dispatch({ type: "SET_ACTIVITY", payload: activity });
      dispatch({ type: "SET_BLOCKERS", payload: blockerList });
      dispatch({ type: "SET_TAGS", payload: allTags });
      dispatch({ type: "SET_TASK_TAG_MAP", payload: tagMap });
      dispatch({ type: "SET_TASK_DEPS_MAP", payload: depsMap });
      dispatch({ type: "SET_NOTIFICATIONS", payload: notifs });
      dispatch({ type: "SET_UNREAD_COUNT", payload: unread });
      dispatch({ type: "SET_WORKTREES", payload: worktrees });
      dispatch({ type: "SET_LOAD_ERROR", payload: null });

      if (projects.length === 0) setShowOnboarding(true);
      setLoaded(true);
      return true;
    }

    function computeRetryDelay(attempt: number, err: unknown, delayMs: number): number {
      // Honor Retry-After on 429/503; otherwise exponential backoff capped at 5s.
      const apiErr = err instanceof ApiError ? err : null;
      const retryAfter = apiErr?.retryAfterMs ?? null;
      const backoff = Math.min(delayMs * 2 ** attempt, 5000);
      return retryAfter !== null ? Math.max(retryAfter, backoff) : backoff;
    }

    async function loadInitialData(retries = 10, delayMs = 500) {
      let lastError: unknown = null;
      for (let i = 0; i < retries; i++) {
        if (cancelled) return;
        try {
          if (await attemptLoad()) return;
        } catch (err) {
          lastError = err;
          console.error(`[loadInitialData] attempt ${i + 1}/${retries} failed:`, err);
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, computeRetryDelay(i, err, delayMs)));
          }
        }
      }
      if (cancelled) return;
      const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
      dispatch({ type: "SET_LOAD_ERROR", payload: `Could not load data after ${retries} attempts: ${message}` });
    }

    loadInitialData();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOnboardingComplete() {
    setShowOnboarding(false);
    // Reload data to reflect newly created project/task. Mirror loadInitialData's
    // per-project milestone fan-out so we don't clobber per-project milestones
    // with a global call that may return an empty list for the new project.
    try {
      const [stats, projects, tasks] = await Promise.all([
        api.getStats(),
        api.getProjects(),
        api.getTasks(),
      ]);
      const allMilestones = (
        await Promise.all(projects.map((p) => api.getMilestones(p.id)))
      ).flat();
      dispatch({ type: "SET_STATS", payload: stats });
      dispatch({ type: "SET_PROJECTS", payload: projects });
      dispatch({ type: "SET_MILESTONES", payload: allMilestones });
      dispatch({ type: "SET_TASKS", payload: tasks });
      if (projects.length > 0) {
        dispatch({ type: "SELECT_PROJECT", payload: projects[0].id });
      }
    } catch (err) {
      console.error("[handleOnboardingComplete] reload failed:", err);
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
          {activeView === "board" ? <TaskBoard /> : activeView === "feed" ? <ActivityStreamView /> : <FleetView />}
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
      {loadError && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            maxWidth: 420,
            padding: "12px 16px",
            background: "var(--bg-secondary)",
            border: "1px solid var(--accent-red, #d32f2f)",
            borderRadius: 6,
            color: "var(--text-primary)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            zIndex: 1000,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Failed to load data</div>
          <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>{loadError}</div>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              padding: "4px 10px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Reload
          </button>
        </div>
      )}
      {loaded && showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} />
      )}
      {commandPaletteOpen && (
        <CommandPalette onClose={() => setCommandPaletteOpen(false)} />
      )}
    </div>
  );
}
