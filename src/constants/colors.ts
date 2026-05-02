import type { TaskStatus, TaskPriority, AgentHealthStatus } from "../types.js";
import {
  TASK_STATUS_TOKEN,
  AGENT_HEALTH_TOKEN,
  tokenToColor,
} from "./statusTokens.js";

export const STATUS_COLORS: Record<TaskStatus, string> = {
  planned: tokenToColor(TASK_STATUS_TOKEN.planned),
  in_progress: tokenToColor(TASK_STATUS_TOKEN.in_progress),
  blocked: tokenToColor(TASK_STATUS_TOKEN.blocked),
  done: tokenToColor(TASK_STATUS_TOKEN.done),
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "var(--accent-red)",
  high: "var(--accent-yellow)",
  medium: "var(--accent-purple)",
  low: "var(--text-muted)",
};

export const HEALTH_COLORS: Record<AgentHealthStatus, string> = {
  active: tokenToColor(AGENT_HEALTH_TOKEN.active),
  idle: tokenToColor(AGENT_HEALTH_TOKEN.idle),
  offline: tokenToColor(AGENT_HEALTH_TOKEN.offline),
};

export const HEALTH_LABELS: Record<AgentHealthStatus, string> = {
  active: "Active",
  idle: "Idle",
  offline: "Offline",
};
