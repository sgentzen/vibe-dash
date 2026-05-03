import type { TaskStatus, TaskPriority, AgentHealthStatus } from "../types.js";

export const STATUS_COLORS: Record<TaskStatus, string> = {
  planned: "var(--text-muted)",
  in_progress: "var(--status-success)",
  blocked: "var(--status-warning)",
  done: "var(--status-info)",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "var(--status-danger)",
  high: "var(--status-warning)",
  medium: "var(--accent-purple)",
  low: "var(--text-muted)",
};

export const HEALTH_COLORS: Record<AgentHealthStatus, string> = {
  active: "var(--status-success)",
  idle: "var(--status-warning)",
  offline: "var(--text-secondary)",
};

export const HEALTH_LABELS: Record<AgentHealthStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};
