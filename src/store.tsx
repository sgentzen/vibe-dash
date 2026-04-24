import React, { createContext, useContext, useReducer, useMemo } from "react";
import type { AppState, AppAction, Theme, ActiveView } from "./state/types";
import { setReducer, getInitialTheme } from "./state/setReducer";
import { wsReducer } from "./state/wsReducer";

export type { AppState, AppAction, Theme, ActiveView };

// ─── Domain slices ────────────────────────────────────────────────────────────

export type DataState = Pick<
  AppState,
  "projects" | "milestones" | "tasks" | "agents" | "activity" | "blockers" |
  "tags" | "taskTagMap" | "taskDepsMap" | "worktrees" | "stats"
>;

export type NavigationState = Pick<
  AppState,
  "selectedProjectId" | "selectedMilestoneId" | "activeView" | "searchQuery" | "theme" |
  "currentUser" | "isAuthenticated" | "authEnabled"
>;

export type NotificationState = Pick<
  AppState,
  "notifications" | "unreadCount" | "fileConflicts"
>;

export type PollingState = Pick<AppState, "pollGeneration">;

// ─── Contexts ─────────────────────────────────────────────────────────────────

const DataContext = createContext<DataState | undefined>(undefined);
const NavigationContext = createContext<NavigationState | undefined>(undefined);
const NotificationContext = createContext<NotificationState | undefined>(undefined);
const PollingContext = createContext<PollingState | undefined>(undefined);
const DispatchContext = createContext<React.Dispatch<AppAction> | undefined>(undefined);

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: AppState = {
  projects: [],
  milestones: [],
  tasks: [],
  agents: [],
  activity: [],
  blockers: [],
  tags: [],
  taskTagMap: {},
  taskDepsMap: {},
  notifications: [],
  unreadCount: 0,
  fileConflicts: [],
  worktrees: [],
  searchQuery: "",
  activeView: "orchestration",
  theme: getInitialTheme(),
  selectedProjectId: null,
  selectedMilestoneId: null,
  stats: { projects: 0, tasks: 0, activeAgents: 0, alerts: 0 },
  pollGeneration: 0,
  currentUser: null,
  isAuthenticated: false,
  authEnabled: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === "WS_EVENT") return wsReducer(state, action.payload);
  const next = setReducer(state, action);
  return next ?? state;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const dataValue = useMemo<DataState>(
    () => ({
      projects: state.projects,
      milestones: state.milestones,
      tasks: state.tasks,
      agents: state.agents,
      activity: state.activity,
      blockers: state.blockers,
      tags: state.tags,
      taskTagMap: state.taskTagMap,
      taskDepsMap: state.taskDepsMap,
      worktrees: state.worktrees,
      stats: state.stats,
    }),
    [
      state.projects, state.milestones, state.tasks, state.agents, state.activity,
      state.blockers, state.tags, state.taskTagMap, state.taskDepsMap,
      state.worktrees, state.stats,
    ]
  );

  const navigationValue = useMemo<NavigationState>(
    () => ({
      selectedProjectId: state.selectedProjectId,
      selectedMilestoneId: state.selectedMilestoneId,
      activeView: state.activeView,
      searchQuery: state.searchQuery,
      theme: state.theme,
      currentUser: state.currentUser,
      isAuthenticated: state.isAuthenticated,
      authEnabled: state.authEnabled,
    }),
    [state.selectedProjectId, state.selectedMilestoneId, state.activeView, state.searchQuery,
     state.theme, state.currentUser, state.isAuthenticated, state.authEnabled]
  );

  const notificationValue = useMemo<NotificationState>(
    () => ({
      notifications: state.notifications,
      unreadCount: state.unreadCount,
      fileConflicts: state.fileConflicts,
    }),
    [state.notifications, state.unreadCount, state.fileConflicts]
  );

  const pollingValue = useMemo<PollingState>(
    () => ({ pollGeneration: state.pollGeneration }),
    [state.pollGeneration]
  );

  return (
    <NavigationContext.Provider value={navigationValue}>
      <NotificationContext.Provider value={notificationValue}>
        <DataContext.Provider value={dataValue}>
          <PollingContext.Provider value={pollingValue}>
            <DispatchContext.Provider value={dispatch}>
              {children}
            </DispatchContext.Provider>
          </PollingContext.Provider>
        </DataContext.Provider>
      </NotificationContext.Provider>
    </NavigationContext.Provider>
  );
}

// ─── Domain hooks ─────────────────────────────────────────────────────────────

export function useDataState(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useDataState must be used within AppProvider");
  return ctx;
}

export function useNavigationState(): NavigationState {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error("useNavigationState must be used within AppProvider");
  return ctx;
}

export function useNotificationState(): NotificationState {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotificationState must be used within AppProvider");
  return ctx;
}

export function usePollingState(): PollingState {
  const ctx = useContext(PollingContext);
  if (!ctx) throw new Error("usePollingState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch(): React.Dispatch<AppAction> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx;
}

// ─── Backward-compatible shim ─────────────────────────────────────────────────
// Components still using useAppState() continue to work. Migrate high-value
// consumers to domain-specific hooks to avoid cross-domain re-renders.

export function useAppState(): AppState {
  const data = useDataState();
  const nav = useNavigationState();
  const notif = useNotificationState();
  const { pollGeneration } = usePollingState();
  return useMemo(
    () => ({ ...data, ...nav, ...notif, pollGeneration }),
    [data, nav, notif, pollGeneration]
  );
}
