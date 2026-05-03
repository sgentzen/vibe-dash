import type {
  Project,
  Task,
  Milestone,
  Agent,
  ActivityEntry,
  Blocker,
  Tag,
  FileConflict,
  AppNotification,
  TaskWorktree,
  WsEvent,
  User,
} from "../types";

export type Theme = "dark" | "light";

export type SearchScope = "tasks" | "projects" | "agents" | "all";

export type ActiveView = "orchestration" | "board" | "agents" | "list" | "dashboard" | "timeline" | "activity" | "worktrees" | "executive";

export interface AppState {
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  agents: Agent[];
  activity: ActivityEntry[];
  blockers: Blocker[];
  tags: Tag[];
  taskTagMap: Record<string, string[]>;
  taskDepsMap: Record<string, string[]>;
  notifications: AppNotification[];
  unreadCount: number;
  fileConflicts: FileConflict[];
  worktrees: TaskWorktree[];
  searchQuery: string;
  searchScope: SearchScope;
  activeView: ActiveView;
  theme: Theme;
  alertsOpen: boolean;
  selectedProjectId: string | null;
  selectedMilestoneId: string | null;
  stats: {
    projects: number;
    tasks: number;
    activeAgents: number;
    alerts: number;
  };
  pollGeneration: number;
  rightRailCollapsed: boolean;
  // Auth
  currentUser: User | null;
  isAuthenticated: boolean;
  authEnabled: boolean;
}

export type AppAction =
  | { type: "SET_PROJECTS"; payload: Project[] }
  | { type: "SET_MILESTONES"; payload: Milestone[] }
  | { type: "SET_TASKS"; payload: Task[] }
  | { type: "SET_AGENTS"; payload: Agent[] }
  | { type: "SET_ACTIVITY"; payload: ActivityEntry[] }
  | { type: "SET_BLOCKERS"; payload: Blocker[] }
  | { type: "SET_TAGS"; payload: Tag[] }
  | { type: "SET_TASK_TAG_MAP"; payload: Record<string, string[]> }
  | { type: "SET_TASK_DEPS_MAP"; payload: Record<string, string[]> }
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_SEARCH_SCOPE"; payload: SearchScope }
  | { type: "SET_ALERTS_OPEN"; payload: boolean }
  | { type: "SET_ACTIVE_VIEW"; payload: ActiveView }
  | { type: "SET_NOTIFICATIONS"; payload: AppNotification[] }
  | { type: "SET_UNREAD_COUNT"; payload: number }
  | { type: "SET_FILE_CONFLICTS"; payload: FileConflict[] }
  | { type: "SET_WORKTREES"; payload: TaskWorktree[] }
  | { type: "SET_STATS"; payload: AppState["stats"] }
  | { type: "SELECT_PROJECT"; payload: string | null }
  | { type: "SELECT_MILESTONE"; payload: string | null }
  | { type: "SET_THEME"; payload: Theme }
  | { type: "INCREMENT_POLL_GENERATION" }
  | { type: "TOGGLE_RIGHT_RAIL" }
  | { type: "SET_RIGHT_RAIL_COLLAPSED"; payload: boolean }
  | { type: "WS_EVENT"; payload: WsEvent }
  | { type: "SET_AUTH"; payload: { currentUser: User | null; isAuthenticated: boolean; authEnabled: boolean } };
