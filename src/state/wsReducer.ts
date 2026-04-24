import type {
  Agent,
  ActivityEntry,
  Blocker,
  Milestone,
  Project,
  Tag,
  TaskTag,
  TaskDependency,
  Task,
  FileConflict,
  AppNotification,
  TaskWorktree,
  WsEvent,
} from "../types";
import type { AppState } from "./types";

export function wsReducer(state: AppState, event: WsEvent): AppState {
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
    case "milestone_created":
      return {
        ...state,
        milestones: [...state.milestones, event.payload as Milestone],
      };
    case "milestone_updated": {
      const updatedMilestone = event.payload as Milestone;
      return {
        ...state,
        milestones: state.milestones.map((m) =>
          m.id === updatedMilestone.id ? updatedMilestone : m
        ),
      };
    }
    case "tag_created": {
      const tag = event.payload as Tag;
      return { ...state, tags: [...state.tags, tag] };
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
      return state;
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
      return state;
    case "daily_stats_recorded":
      return state;
    case "worktree_created": {
      const wt = event.payload as TaskWorktree;
      return { ...state, worktrees: [wt, ...state.worktrees] };
    }
    case "worktree_updated": {
      const updated = event.payload as TaskWorktree;
      return {
        ...state,
        worktrees: state.worktrees.map((w) => (w.id === updated.id ? updated : w)),
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
