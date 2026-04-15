export type TaskStatus = "planned" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type MilestoneStatus = "open" | "achieved";

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  acceptance_criteria: string | null;
  target_date: string | null;
  status: MilestoneStatus;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  parent_task_id: string | null;
  milestone_id: string | null;
  assigned_agent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  due_date: string | null;
  start_date: string | null;
  estimate: number | null;
  recurrence_rule: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  template_json: string;
  created_at: string;
}

export type AgentRole = "orchestrator" | "coder" | "reviewer" | "explorer" | "planner" | "agent";

export interface Agent {
  id: string;
  name: string;
  model: string | null;
  capabilities: string[];
  role: AgentRole;
  parent_agent_id: string | null;
  registered_at: string;
  last_seen_at: string;
  current_task_title?: string | null;
  current_project_id?: string | null;
  current_project_name?: string | null;
}

export interface ActivityEntry {
  id: string;
  task_id: string;
  agent_id: string | null;
  message: string;
  timestamp: string;
  agent_name?: string | null;
  task_title?: string | null;
  project_name?: string | null;
  project_id?: string | null;
  parent_agent_name?: string | null;
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

export interface MilestoneProgress {
  task_count: number;
  completed_count: number;
  completion_pct: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  agent_id: string | null;
  author_name: string;
  message: string;
  created_at: string;
}

export interface AgentFileLock {
  id: string;
  agent_id: string;
  task_id: string;
  file_path: string;
  started_at: string;
}

export interface FileConflict {
  file_path: string;
  agents: { agent_id: string; agent_name: string; task_id: string }[];
}

export interface AlertRule {
  id: string;
  event_type: string;
  filter_json: string;
  enabled: boolean;
  created_at: string;
}

export interface AppNotification {
  id: string;
  rule_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
}

export interface AgentStats {
  agent_id: string;
  tasks_completed_total: number;
  tasks_completed_milestone: number;
  tasks_completed_today: number;
  avg_completion_time_seconds: number | null;
  blocker_rate: number;
  activity_frequency: number;
}

export interface AgentContribution {
  agent_id: string;
  agent_name: string;
  completed_count: number;
  completed_points: number;
}

export interface MilestoneDailyStats {
  milestone_id: string;
  date: string;
  completed_tasks: number;
  total_tasks: number;
  completion_pct: number;
}

export interface ActivityHeatmapEntry {
  hour: number;
  agent_id: string;
  agent_name: string;
  count: number;
}

export interface Webhook {
  id: string;
  url: string;
  event_types: string[];
  active: boolean;
  created_at: string;
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
  | "milestone_created"
  | "milestone_updated"
  | "tag_created"
  | "tag_added"
  | "tag_removed"
  | "dependency_added"
  | "dependency_removed"
  | "session_started"
  | "session_ended"
  | "comment_added"
  | "file_lock_acquired"
  | "file_conflict_detected"
  | "notification_created"
  | "daily_stats_recorded";

export interface WsEvent {
  type: WsEventType;
  payload: Project | Task | Agent | ActivityEntry | Blocker | Milestone | Tag | TaskTag | AgentSession | TaskDependency | TaskComment | AgentFileLock | FileConflict | AppNotification | MilestoneDailyStats;
}
