import type { ActivityEntry, Agent, AgentSession } from "../../types";

export interface AgentDetail {
  agent: Agent;
  health_status: string;
  completed_today: number;
  current_task_title: string | null;
  activity: ActivityEntry[];
  sessions: AgentSession[];
}

export type StatusFilter = "active+idle" | "all" | "offline";

export const FILTER_LABELS: Record<StatusFilter, string> = {
  "active+idle": "Active",
  all: "All",
  offline: "Offline",
};
