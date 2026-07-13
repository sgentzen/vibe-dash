import type {
  Project,
  Task,
  Milestone,
  Agent,
  ActivityEntry,
  Blocker,
  WsEvent,
} from "../types";

export type Theme = "dark" | "light";

export type SearchScope = "tasks" | "projects" | "agents" | "all";

export type ActiveView = "fleet" | "board" | "feed";

export type FleetPreset = "overview" | "agents";

export interface AppState {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  agents: Agent[];
  activity: ActivityEntry[];
  blockers: Blocker[];
  taskDepsMap: Record<string, string[]>;
  fileConflicts: unknown[];
  searchQuery: string;
  searchScope: SearchScope;
  activeView: ActiveView;
  fleetPreset: FleetPreset;
  theme: Theme;
  selectedProjectId: string | null;
  selectedMilestoneId: string | null;
  stats: {
    projects: number;
    tasks: number;
    activeAgents: number;
    alerts: number;
    spend_today: number;
    tasks_completed_today: number;
  };
  pollGeneration: number;
  rightRailCollapsed: boolean;
  loadError: string | null;
}

export type AppAction =
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_MILESTONES"; payload: Milestone[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "SET_ACTIVITY"; payload: ActivityEntry[] }
  | { type: "SET_BLOCKERS"; payload: Blocker[] }
  | { type: "SET_TASK_DEPS_MAP"; payload: Record<string, string[]> }
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_SEARCH_SCOPE"; payload: SearchScope }
  | { type: "SET_ACTIVE_VIEW"; payload: ActiveView }
  | { type: "SET_FLEET_PRESET"; payload: FleetPreset }
  | { type: "SET_STATS"; payload: AppState["stats"] }
  | { type: "SELECT_PROJECT"; payload: string | null }
  | { type: "SELECT_MILESTONE"; payload: string | null }
  | { type: "SET_THEME"; payload: Theme }
  | { type: "INCREMENT_POLL_GENERATION" }
  | { type: "TOGGLE_RIGHT_RAIL" }
  | { type: "SET_RIGHT_RAIL_COLLAPSED"; payload: boolean }
  | { type: "WS_EVENT"; payload: WsEvent }
  | { type: "SET_LOAD_ERROR"; payload: string | null };
