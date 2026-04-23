import React, { createContext, useContext, useReducer } from "react";
import type { AppState, AppAction, Theme } from "./state/types";
import { setReducer, getInitialTheme } from "./state/setReducer";
import { wsReducer } from "./state/wsReducer";

export type { AppState, AppAction, Theme };

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
};

function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === "WS_EVENT") return wsReducer(state, action.payload);
  const next = setReducer(state, action);
  return next ?? state;
}

const StateContext = createContext<AppState | undefined>(undefined);
const DispatchContext = createContext<React.Dispatch<AppAction> | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>
        {children}
      </DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch(): React.Dispatch<AppAction> {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx;
}
