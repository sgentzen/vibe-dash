export type TaskStatus = "planned" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  name: string;
  model: string | null;
  capabilities: string[];
  registered_at: string;
  last_seen_at: string;
}

export interface ActivityEntry {
  id: string;
  task_id: string;
  agent_id: string | null;
  message: string;
  timestamp: string;
}

export interface Blocker {
  id: string;
  task_id: string;
  reason: string;
  reported_at: string;
  resolved_at: string | null;
}

export type WsEventType =
  | "project_created"
  | "task_created"
  | "task_updated"
  | "task_completed"
  | "agent_registered"
  | "agent_activity"
  | "blocker_reported"
  | "blocker_resolved";

export interface WsEvent {
  type: WsEventType;
  payload: Project | Task | Agent | ActivityEntry | Blocker;
}
