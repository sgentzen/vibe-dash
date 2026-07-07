import type { AppState, AppAction, Theme, SearchScope } from "./types";

const THEME_STORAGE_KEY = "vibe-dash-theme";
const RIGHT_RAIL_STORAGE_KEY = "vibe-dash-right-rail";
const SEARCH_SCOPE_STORAGE_KEY = "vibe-dash-search-scope";

// Allowlists of the only values ever read from / written to browser storage.
// Persisting a value selected *from these constants* (rather than the raw,
// possibly-tainted action payload) keeps untrusted data out of localStorage.
const THEMES = ["light", "dark"] as const;
const SEARCH_SCOPES = ["tasks", "projects", "agents", "all"] as const;

export function getInitialRightRailCollapsed(): boolean {
  return localStorage.getItem(RIGHT_RAIL_STORAGE_KEY) === "true";
}

export function getInitialTheme(): Theme {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  const stored = THEMES.find((t) => t === raw);
  if (stored) return stored;
  if (globalThis.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function getInitialSearchScope(): SearchScope {
  const raw = localStorage.getItem(SEARCH_SCOPE_STORAGE_KEY);
  return SEARCH_SCOPES.find((s) => s === raw) ?? "all";
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
    case "SET_TASK_DEPS_MAP":
      return { ...state, taskDepsMap: action.payload };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload };
    case "SET_SEARCH_SCOPE": {
      // Persist a value taken from the SEARCH_SCOPES constant, never the raw payload.
      const scope = SEARCH_SCOPES.find((s) => s === action.payload);
      if (scope) localStorage.setItem(SEARCH_SCOPE_STORAGE_KEY, scope);
      return { ...state, searchScope: action.payload };
    }
    case "SET_ACTIVE_VIEW":
      return { ...state, activeView: action.payload };
    case "SET_FLEET_PRESET":
      return { ...state, fleetPreset: action.payload };
    case "SET_WORKTREES":
      return { ...state, worktrees: action.payload };
    case "SET_STATS":
      return { ...state, stats: action.payload };
    case "SELECT_PROJECT":
      return { ...state, selectedProjectId: action.payload, selectedMilestoneId: null };
    case "SELECT_MILESTONE":
      return { ...state, selectedMilestoneId: action.payload };
    case "SET_THEME": {
      // Persist a value taken from the THEMES constant, never the raw payload.
      const theme = THEMES.find((t) => t === action.payload);
      if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme);
      return { ...state, theme: action.payload };
    }
    case "INCREMENT_POLL_GENERATION":
      return { ...state, pollGeneration: state.pollGeneration + 1 };
    case "TOGGLE_RIGHT_RAIL": {
      const next = !state.rightRailCollapsed;
      localStorage.setItem(RIGHT_RAIL_STORAGE_KEY, String(next));
      return { ...state, rightRailCollapsed: next };
    }
    case "SET_RIGHT_RAIL_COLLAPSED":
      // Does NOT persist to localStorage — used for programmatic collapse (e.g. auto-collapse on Timeline)
      // so it doesn't override the user's stored preference.
      return { ...state, rightRailCollapsed: action.payload };
    case "SET_LOAD_ERROR":
      return { ...state, loadError: action.payload };
    default:
      return null;
  }
}
