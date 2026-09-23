import type {
  Project,
  WsEvent,
} from "../types";
import type { AppState } from "./types";

// Default project list excludes archived (matches GET /api/projects'
// default), so drop it from state; a "show archived" view fetches its own
// list separately rather than reading state.projects. Idempotent: a project
// already absent (e.g. another tab already applied this event) leaves stats
// untouched. Extracted out of wsReducer's switch to keep that function's
// cognitive complexity down (sonarjs/cognitive-complexity).
function applyProjectArchived(state: AppState, archived: Project): AppState {
  const wasPresent = state.projects.some((p) => p.id === archived.id);
  if (!wasPresent) return state;
  return {
    ...state,
    projects: state.projects.filter((p) => p.id !== archived.id),
    selectedProjectId: state.selectedProjectId === archived.id ? null : state.selectedProjectId,
    stats: { ...state.stats, projects: Math.max(0, state.stats.projects - 1) },
  };
}

function applyProjectUnarchived(state: AppState, unarchived: Project): AppState {
  const alreadyPresent = state.projects.some((p) => p.id === unarchived.id);
  if (alreadyPresent) return state;
  return {
    ...state,
    projects: [...state.projects, unarchived],
    stats: { ...state.stats, projects: state.stats.projects + 1 },
  };
}

export function wsReducer(state: AppState, event: WsEvent): AppState {
  switch (event.type) {
    case "project_created":
      return {
        ...state,
        projects: [...state.projects, event.payload],
        stats: { ...state.stats, projects: state.stats.projects + 1 },
      };
    case "task_created": {
      const newTask = event.payload;
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
      const updated = event.payload;
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
      const agent = event.payload;
      const exists = state.agents.some((a) => a.id === agent.id);
      return {
        ...state,
        agents: exists
          ? state.agents.map((a) => (a.id === agent.id ? { ...a, ...agent } : a))
          : [...state.agents, agent],
      };
    }
    case "agent_activity": {
      const entry = event.payload;
      const capped = [entry, ...state.activity].slice(0, 100);
      return { ...state, activity: capped };
    }
    case "blocker_reported":
      return {
        ...state,
        blockers: [...state.blockers, event.payload],
        stats: { ...state.stats, alerts: state.stats.alerts + 1 },
      };
    case "blocker_resolved": {
      const resolved = event.payload;
      return {
        ...state,
        blockers: state.blockers.filter((b) => b.id !== resolved.id),
        stats: {
          ...state.stats,
          alerts: Math.max(0, state.stats.alerts - 1),
        },
      };
    }
    case "project_archived":
      return applyProjectArchived(state, event.payload);
    case "project_unarchived":
      return applyProjectUnarchived(state, event.payload);
    case "milestone_created":
      return {
        ...state,
        milestones: [...state.milestones, event.payload],
      };
    case "milestone_updated": {
      const updatedMilestone = event.payload;
      return {
        ...state,
        milestones: state.milestones.map((m) =>
          m.id === updatedMilestone.id ? updatedMilestone : m
        ),
      };
    }
    case "dependency_added": {
      const dep = event.payload;
      const existing = state.taskDepsMap[dep.task_id] ?? [];
      if (existing.includes(dep.depends_on_task_id)) return state;
      return {
        ...state,
        taskDepsMap: { ...state.taskDepsMap, [dep.task_id]: [...existing, dep.depends_on_task_id] },
      };
    }
    case "daily_stats_recorded":
      return state;
    case "dependency_removed": {
      const dep = event.payload;
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
