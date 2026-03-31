import React, { createContext, useContext, useReducer } from "react";
import type { Project, Task, Sprint, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, TaskComment, FileConflict, AppNotification, WsEvent } from "./types";

export interface AppState {
  projects: Project[];
  sprints: Sprint[];
  tasks: Task[];
  agents: Agent[];
  activity: ActivityEntry[];
  blockers: Blocker[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>; // task_id -> tag_id[]
  taskDepsMap: Record<string, string[]>; // task_id -> depends_on_task_id[]
  notifications: AppNotification[];
  unreadCount: number;
  fileConflicts: FileConflict[];
  searchQuery: string;
  activeView: "board" | "agents" | "list";
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
  taskDepsMap: {},
  notifications: [],
  unreadCount: 0,
  fileConflicts: [],
  searchQuery: "",
  activeView: "board",
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
  | { type: "SET_ACTIVE_VIEW"; payload: "board" | "agents" | "list" }
  | { type: "SET_NOTIFICATIONS"; payload: AppNotification[] }
  | { type: "SET_UNREAD_COUNT"; payload: number }
  | { type: "SET_FILE_CONFLICTS"; payload: FileConflict[] }
  | { type: "SET_STATS"; payload: AppState["stats"] }
  | { type: "SELECT_PROJECT"; payload: string | null }
  | { type: "SELECT_SPRINT"; payload: string | null }
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
    case "SET_NOTIFICATIONS":
      return { ...state, notifications: action.payload };
    case "SET_UNREAD_COUNT":
      return { ...state, unreadCount: action.payload };
    case "SET_FILE_CONFLICTS":
      return { ...state, fileConflicts: action.payload };
    case "SET_STATS":
      return { ...state, stats: action.payload };
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.payload, selectedSprintId: null };
    case "SELECT_SPRINT":
      return { ...state, selectedSprintId: action.payload };
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
        case "comment_added":
          return state; // comments are loaded on demand per task
        case "notification_created": {
          const notif = event.payload as AppNotification;
          return {
            ...state,
            notifications: [notif, ...state.notifications],
            unreadCount: state.unreadCount + 1,
          };
        }
        case "file_conflict_detected": {
          const conflict = event.payload as FileConflict;
          const existing = state.fileConflicts.filter((c) => c.file_path !== conflict.file_path);
          return { ...state, fileConflicts: [...existing, conflict] };
        }
        case "file_lock_acquired":
          return state; // locks managed via conflicts
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
