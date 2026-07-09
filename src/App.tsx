import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { useDataState, useNavigationState, useNotificationState, useAppDispatch } from "./store";
import { useApi, ApiError } from "./hooks/useApi";
import { useWebSocket } from "./hooks/useWebSocket";
import { usePolling } from "./hooks/usePolling";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { getInitialRightRailCollapsed } from "./state/setReducer";
import { readStoredAccentColor } from "./utils/accent";
import { TopBar } from "./components/TopBar";
import { ProjectList } from "./components/ProjectList";
import { TaskBoard } from "./components/TaskBoard";
import { ActivityStreamView } from "./components/ActivityStreamView";
import { FleetView } from "./components/fleet/FleetView";
import { AgentFeed } from "./components/AgentFeed";
import { AlertBanner } from "./components/AlertBanner";
import { OnboardingWizard } from "./components/OnboardingWizard";
import { ProjectContextChip } from "./components/ProjectContextChip";
import { CommandPalette } from "./components/CommandPalette";
import { RailDrawers } from "./components/RailDrawers";

/** Human-readable description of a caught value, avoiding "[object Object]". */
function describeLoadError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return "unknown error";
  if (typeof err === "object") return "unknown error";
  return String(err);
}

export function App() {
  const dispatch = useAppDispatch();
  const { blockers } = useDataState();
  const { theme, activeView, fleetPreset, rightRailCollapsed } = useNavigationState();
  const { fileConflicts, loadError } = useNotificationState();
  const api = useApi();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [drawer, setDrawer] = useState<null | "left" | "right">(null);
  const gKeyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gKeyPending = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const clearSearch = useCallback(() => {
    dispatch({ type: "SET_SEARCH_QUERY", payload: "" });
  }, [dispatch]);

  useKeyboardShortcuts({ searchInputRef, onClearSearch: clearSearch });
  useWebSocket();
  usePolling();

  // Auto-collapse right rail on views where it would obscure content.
  // Uses SET_RIGHT_RAIL_COLLAPSED (not TOGGLE) so it doesn't write to localStorage
  // and doesn't permanently override the user's stored preference.
  useEffect(() => {
    if (activeView === "fleet" && fleetPreset === "agents") {
      dispatch({ type: "SET_RIGHT_RAIL_COLLAPSED", payload: true });
    } else {
      // Restore the user's persisted preference when not on the agents
      // preset, so the rail doesn't stay hidden after a one-off visit.
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
        setDrawer(null);
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
        const presetMap: Record<string, "overview" | "agents"> = {
          o: "overview",
          a: "agents",
        };
        const preset = presetMap[e.key];
        if (preset) {
          dispatch({ type: "SET_ACTIVE_VIEW", payload: "fleet" });
          dispatch({ type: "SET_FLEET_PRESET", payload: preset });
        }
      }
    }

    globalThis.addEventListener("keydown", handleKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      if (gKeyTimer.current !== null) {
        clearTimeout(gKeyTimer.current);
        gKeyTimer.current = null;
      }
    };
  }, [dispatch]);

  // Measure the header's rendered height and publish it as a CSS custom
  // property so the narrow-width drawer/backdrop offsets (App.css) can
  // track it instead of relying on a hardcoded pixel value that breaks
  // when the header wraps to a second row.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    // Intentionally left on documentElement for the app's lifetime — App
    // never unmounts in practice, so there's no cleanup to do here.
    function applyHeight(height: number) {
      document.documentElement.style.setProperty("--header-height", `${height}px`);
    }

    // Set an initial value synchronously so first paint is correct.
    applyHeight(el.getBoundingClientRect().height);

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) applyHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // Restore custom accent color (validated — corrupted/tainted storage is ignored)
    const accent = readStoredAccentColor();
    if (accent) {
      document.documentElement.style.setProperty("--accent-user", accent);
      document.documentElement.dataset.accent = "true";
    }
  }, [theme]);

  useEffect(() => {
    let cancelled = false;

    // Atomic load: gather everything first, dispatch only once on success.
    // This prevents partially-failed retries from clobbering previously-good
    // state with empty arrays while the server is mid-restart.
    async function attemptLoad(): Promise<void> {
      const [stats, projects, tasks, agents, activity, blockerList] = await Promise.all([
        api.getStats(), api.getProjects(), api.getTasks(),
        api.getAgents(), api.getActivity(), api.getBlockers(),
      ]);
      if (cancelled) return;

      const [allMilestones, allDeps, worktrees] = await Promise.all([
        Promise.all(projects.map((p) => api.getMilestones(p.id))).then((r) => r.flat()),
        Promise.all(projects.map((p) => api.getProjectTaskDependencies(p.id))).then((r) => r.flat()),
        api.getWorktrees(),
      ]);
      if (cancelled) return;

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
      dispatch({ type: "SET_TASK_DEPS_MAP", payload: depsMap });
      dispatch({ type: "SET_WORKTREES", payload: worktrees });
      dispatch({ type: "SET_LOAD_ERROR", payload: null });

      if (projects.length === 0) setShowOnboarding(true);
      setLoaded(true);
    }

    function computeRetryDelay(attempt: number, err: unknown, delayMs: number): number {
      // Honor Retry-After on 429/503; otherwise exponential backoff capped at 5s.
      const apiErr = err instanceof ApiError ? err : null;
      const retryAfter = apiErr?.retryAfterMs ?? null;
      const backoff = Math.min(delayMs * 2 ** attempt, 5000);
      return retryAfter === null ? backoff : Math.max(retryAfter, backoff);
    }

    async function loadInitialData(retries = 10, delayMs = 500) {
      let lastError: unknown = null;
      for (let i = 0; i < retries; i++) {
        if (cancelled) return;
        try {
          // attemptLoad resolves only on success or cancellation, and throws on
          // failure — so a normal return means we're done and should stop retrying.
          await attemptLoad();
          return;
        } catch (err) {
          lastError = err;
          // Template literal is interpolated before console.error is called, so no
          // util.format-style specifier injection is possible (i, retries are numbers).
          // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
          console.error(`[loadInitialData] attempt ${i + 1}/${retries} failed:`, err);
          if (i < retries - 1) {
            await new Promise((r) => setTimeout(r, computeRetryDelay(i, err, delayMs)));
          }
        }
      }
      if (cancelled) return;
      const message = describeLoadError(lastError);
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

  return (
    <div className="app">
      <div ref={headerRef}>
        <TopBar onCommandPalette={() => setCommandPaletteOpen(true)} searchInputRef={searchInputRef} />
      </div>
      <div className={`main-content${rightRailCollapsed ? " rail-collapsed" : ""}`}>
        <RailDrawers
          drawer={drawer}
          onOpenLeft={() => setDrawer("left")}
          onOpenRight={() => setDrawer("right")}
          onClose={() => setDrawer(null)}
          left={<ProjectList />}
          topRow={<ProjectContextChip />}
          right={
            rightRailCollapsed ? (
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
            )
          }
        >
          {(() => {
            if (activeView === "board") return <TaskBoard />;
            if (activeView === "feed") return <ActivityStreamView />;
            return <FleetView />;
          })()}
        </RailDrawers>
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
            onClick={() => globalThis.location.reload()}
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
