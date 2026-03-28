import React, { createContext, useContext, useReducer } from "react";
import type { Project, Task, Agent, ActivityEntry, Blocker, WsEvent } from "./types";

export interface AppState {
  projects: Project[];
  tasks: Task[];
  agents: Agent[];
  activity: ActivityEntry[];
  blockers: Blocker[];
  selectedProjectId: string | null;
  stats: {
    projects: number;
    tasks: number;
    activeAgents: number;
    alerts: number;
  };
}

const initialState: AppState = {
  projects: [],
  tasks: [],
  agents: [],
  activity: [],
  blockers: [],
  selectedProjectId: null,
  stats: { projects: 0, tasks: 0, activeAgents: 0, alerts: 0 },
};

export type AppAction =
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "SET_ACTIVITY"; payload: ActivityEntry[] }
  | { type: "SET_BLOCKERS"; payload: Blocker[] }
  | { type: "SET_STATS"; payload: AppState["stats"] }
  | { type: "SELECT_PROJECT"; payload: string | null }
  | { type: "WS_EVENT"; payload: WsEvent };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_PROJECTS":
      return { ...state, projects: action.payload };
    case "SET_TASKS":
      return { ...state, tasks: action.payload };
    case "SET_AGENTS":
      return { ...state, agents: action.payload };
    case "SET_ACTIVITY":
      return { ...state, activity: action.payload };
    case "SET_BLOCKERS":
      return { ...state, blockers: action.payload };
    case "SET_STATS":
      return { ...state, stats: action.payload };
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.payload };
    case "WS_EVENT": {
      const event = action.payload;
      switch (event.type) {
        case "project_created":
          return {
            ...state,
            projects: [...state.projects, event.payload as Project],
            stats: { ...state.stats, projects: state.stats.projects + 1 },
          };
        case "task_created":
          return {
            ...state,
            tasks: [...state.tasks, event.payload as Task],
            stats: { ...state.stats, tasks: state.stats.tasks + 1 },
          };
        case "task_updated":
        case "task_completed": {
          const updated = event.payload as Task;
          return {
            ...state,
            tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)),
          };
        }
        case "agent_registered": {
          const agent = event.payload as Agent;
          const exists = state.agents.some((a) => a.id === agent.id);
          return {
            ...state,
            agents: exists
              ? state.agents.map((a) => (a.id === agent.id ? agent : a))
              : [...state.agents, agent],
          };
        }
        case "agent_activity": {
          const entry = event.payload as ActivityEntry;
          const capped = [entry, ...state.activity].slice(0, 100);
          return { ...state, activity: capped };
        }
        case "blocker_reported":
          return {
            ...state,
            blockers: [...state.blockers, event.payload as Blocker],
            stats: { ...state.stats, alerts: state.stats.alerts + 1 },
          };
        case "blocker_resolved": {
          const resolved = event.payload as Blocker;
          return {
            ...state,
            blockers: state.blockers.filter((b) => b.id !== resolved.id),
            stats: {
              ...state.stats,
              alerts: Math.max(0, state.stats.alerts - 1),
            },
          };
        }
        default:
          return state;
      }
    }
    default:
      return state;
  }
}

const StateContext = createContext<AppState | undefined>(undefined);
const DispatchContext = createContext<React.Dispatch<AppAction> | undefined>(
  undefined
);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return React.createElement(
    StateContext.Provider,
    { value: state },
    React.createElement(DispatchContext.Provider, { value: dispatch }, children)
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
