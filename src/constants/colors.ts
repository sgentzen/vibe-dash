import type { TaskStatus, TaskPriority, AgentHealthStatus } from "../types.js";

export const STATUS_COLORS: Record<TaskStatus, string> = {
  planned: "var(--text-muted)",
  in_progress: "var(--accent-green)",
  blocked: "var(--accent-yellow)",
  done: "var(--accent-blue)",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "var(--accent-red)",
  high: "var(--accent-yellow)",
  medium: "var(--accent-purple)",
  low: "var(--text-muted)",
};

export const HEALTH_COLORS: Record<AgentHealthStatus, string> = {
  active: "var(--accent-green)",
  idle: "var(--accent-yellow)",
  offline: "var(--text-secondary)",
};

export const HEALTH_LABELS: Record<AgentHealthStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};
