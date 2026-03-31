import React, { createContext, useContext, useReducer } from "react";
import type { Project, Task, Sprint, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, WsEvent } from "./types";

export type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "vibe-dash-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export interface AppState {
  projects: Project[];
  sprints: Sprint[];
  tasks: Task[];
  agents: Agent[];
  activity: ActivityEntry[];
  blockers: Blocker[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>; // task_id -> tag_id[]
  theme: Theme;
  selectedProjectId: string | null;
  selectedSprintId: string | null;
  stats: {
    projects: number;
    tasks: number;
    activeAgents: number;
    alerts: number;
  };
}

const initialState: AppState = {
  projects: [],
  sprints: [],
  tasks: [],
  agents: [],
  activity: [],
  blockers: [],
  tags: [],
  taskTagMap: {},
  theme: getInitialTheme(),
  selectedProjectId: null,
  selectedSprintId: null,
  stats: { projects: 0, tasks: 0, activeAgents: 0, alerts: 0 },
};

export type AppAction =
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_SPRINTS"; payload: Sprint[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "SET_ACTIVITY"; payload: ActivityEntry[] }
  | { type: "SET_BLOCKERS"; payload: Blocker[] }
  | { type: "SET_TAGS"; payload: Tag[] }
  | { type: "SET_TASK_TAG_MAP"; payload: Record<string, string[]> }
  | { type: "SET_TASK_DEPS_MAP"; payload: Record<string, string[]> }
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_ACTIVE_VIEW"; payload: "board" | "agents" }
  | { type: "SET_STATS"; payload: AppState["stats"] }
  | { type: "SELECT_PROJECT"; payload: string | null }
  | { type: "SELECT_SPRINT"; payload: string | null }
  | { type: "SET_THEME"; payload: Theme }
  | { type: "WS_EVENT"; payload: WsEvent };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_PROJECTS":
      return { ...state, projects: action.payload };
    case "SET_SPRINTS":
      return { ...state, sprints: action.payload };
    case "SET_TASKS":
      return { ...state, tasks: action.payload };
    case "SET_AGENTS":
      return { ...state, agents: action.payload };
    case "SET_ACTIVITY":
      return { ...state, activity: action.payload };
    case "SET_BLOCKERS":
      return { ...state, blockers: action.payload };
    case "SET_TAGS":
      return { ...state, tags: action.payload };
    case "SET_TASK_TAG_MAP":
      return { ...state, taskTagMap: action.payload };
    case "SET_TASK_DEPS_MAP":
      return { ...state, taskDepsMap: action.payload };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload };
    case "SET_ACTIVE_VIEW":
      return { ...state, activeView: action.payload };
    case "SET_STATS":
      return { ...state, stats: action.payload };
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.payload, selectedSprintId: null };
    case "SELECT_SPRINT":
      return { ...state, selectedSprintId: action.payload };
    case "SET_THEME":
      localStorage.setItem(THEME_STORAGE_KEY, action.payload);
      return { ...state, theme: action.payload };
    case "WS_EVENT": {
      const event = action.payload;
      switch (event.type) {
        case "project_created":
          return {
            ...state,
            projects: [...state.projects, event.payload as Project],
            stats: { ...state.stats, projects: state.stats.projects + 1 },
          };
        case "task_created": {
          const newTask = event.payload as Task;
          return {
            ...state,
            tasks: [...state.tasks, newTask],
            stats: {
              ...state.stats,
              tasks: newTask.status === "done" ? state.stats.tasks : state.stats.tasks + 1,
            },
          };
        }
        case "task_updated":
        case "task_completed": {
          const updated = event.payload as Task;
          const prev = state.tasks.find((t) => t.id === updated.id);
          const wasDone = prev?.status === "done";
          const nowDone = updated.status === "done";
          let tasksDelta = 0;
          if (!wasDone && nowDone) tasksDelta = -1;
          if (wasDone && !nowDone) tasksDelta = 1;
          return {
            ...state,
            tasks: state.tasks.map((t) => (t.id === updated.id ? updated : t)),
            stats: { ...state.stats, tasks: state.stats.tasks + tasksDelta },
          };
        }
        case "agent_registered": {
          const agent = event.payload as Agent;
          const exists = state.agents.some((a) => a.id === agent.id);
          return {
            ...state,
            agents: exists
              ? state.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a))
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
        case "sprint_created":
          return {
            ...state,
            sprints: [...state.sprints, event.payload as Sprint],
          };
        case "sprint_updated": {
          const updatedSprint = event.payload as Sprint;
          return {
            ...state,
            sprints: state.sprints.map((s) =>
              s.id === updatedSprint.id ? updatedSprint : s
            ),
          };
        }
        case "tag_created": {
          const tag = event.payload as Tag;
          return {
            ...state,
            tags: [...state.tags, tag],
          };
        }
        case "tag_added": {
          const tt = event.payload as TaskTag;
          const existing = state.taskTagMap[tt.task_id] ?? [];
          if (existing.includes(tt.tag_id)) return state;
          return {
            ...state,
            taskTagMap: { ...state.taskTagMap, [tt.task_id]: [...existing, tt.tag_id] },
          };
        }
        case "tag_removed": {
          const tt = event.payload as TaskTag;
          const current = state.taskTagMap[tt.task_id] ?? [];
          return {
            ...state,
            taskTagMap: { ...state.taskTagMap, [tt.task_id]: current.filter((id) => id !== tt.tag_id) },
          };
        }
        case "dependency_added": {
          const dep = event.payload as TaskDependency;
          const existing = state.taskDepsMap[dep.task_id] ?? [];
          if (existing.includes(dep.depends_on_task_id)) return state;
          return {
            ...state,
            taskDepsMap: { ...state.taskDepsMap, [dep.task_id]: [...existing, dep.depends_on_task_id] },
          };
        }
        case "dependency_removed": {
          const dep = event.payload as TaskDependency;
          const deps = state.taskDepsMap[dep.task_id] ?? [];
          return {
            ...state,
            taskDepsMap: { ...state.taskDepsMap, [dep.task_id]: deps.filter((id) => id !== dep.depends_on_task_id) },
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
