import type { AppState, AppAction, Theme } from "./types";

const THEME_STORAGE_KEY = "vibe-dash-theme";

export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function setReducer(state: AppState, action: AppAction): AppState | null {
  switch (action.type) {
    case "SET_PROJECTS":
      return { ...state, projects: action.payload };
    case "SET_MILESTONES":
      return { ...state, milestones: action.payload };
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
    case "SET_WORKTREES":
      return { ...state, worktrees: action.payload };
    case "SET_STATS":
      return { ...state, stats: action.payload };
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.payload, selectedMilestoneId: null };
    case "SELECT_MILESTONE":
      return { ...state, selectedMilestoneId: action.payload };
    case "SET_THEME":
      localStorage.setItem(THEME_STORAGE_KEY, action.payload);
      return { ...state, theme: action.payload };
    case "INCREMENT_POLL_GENERATION":
      return { ...state, pollGeneration: state.pollGeneration + 1 };
    case "SET_AUTH":
      return { ...state, ...action.payload };
    default:
      return null;
  }
}
