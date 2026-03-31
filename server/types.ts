export type TaskStatus = "planned" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type SprintStatus = "planned" | "active" | "completed";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: SprintStatus;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  sprint_id: string | null;
  assigned_agent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  due_date: string | null;
  estimate: number | null;
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
  current_task_title?: string | null;
}

export interface ActivityEntry {
  id: string;
  task_id: string;
  agent_id: string | null;
  message: string;
  timestamp: string;
  agent_name?: string | null;
  task_title?: string | null;
}

export type AgentHealthStatus = "active" | "idle" | "offline";

export interface Tag {
  id: string;
  project_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface TaskTag {
  id: string;
  task_id: string;
  tag_id: string;
}

export interface AgentSession {
  id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  last_activity_at: string;
  tasks_touched: number;
  activity_count: number;
}

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  filter_json: string;
  created_at: string;
}

export interface SprintCapacity {
  total_estimated: number;
  completed_points: number;
  remaining_points: number;
  task_count: number;
  completed_count: number;
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
  | "task_assigned"
  | "task_unassigned"
  | "agent_registered"
  | "agent_activity"
  | "blocker_reported"
  | "blocker_resolved"
  | "sprint_created"
  | "sprint_updated"
  | "tag_created"
  | "tag_added"
  | "tag_removed"
  | "dependency_added"
  | "dependency_removed"
  | "session_started"
  | "session_ended";

export interface WsEvent {
  type: WsEventType;
  payload: Project | Task | Agent | ActivityEntry | Blocker | Sprint | Tag | TaskTag | AgentSession | TaskDependency;
}
