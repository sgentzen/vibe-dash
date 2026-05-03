import type { TaskStatus, AgentHealthStatus } from "../types.js";

export type StatusToken = "success" | "warning" | "danger" | "info" | "neutral";

export type MilestoneHealthStatus = "on_track" | "at_risk" | "behind";

export const TASK_STATUS_TOKEN: Record<TaskStatus, StatusToken> = {
  planned: "neutral",
  in_progress: "success",
  blocked: "danger",
  done: "info",
};

export const MILESTONE_HEALTH_TOKEN: Record<MilestoneHealthStatus, StatusToken> = {
  on_track: "success",
  at_risk: "warning",
  behind: "danger",
};

export const AGENT_HEALTH_TOKEN: Record<AgentHealthStatus, StatusToken> = {
  active: "success",
  idle: "warning",
  offline: "neutral",
};

export function tokenToColor(token: StatusToken): string {
  return `var(--status-${token})`;
}
