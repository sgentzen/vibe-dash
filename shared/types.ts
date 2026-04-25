// Single source of truth for types shared between server and client.
// Both server/types.ts and src/types.ts re-export from this module.

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
  acceptance_criteria: string;
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
  task_type: string | null;
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

export type ReviewStatus = "pending" | "approved" | "changes_requested";

export type WorktreeStatus = "active" | "merged" | "abandoned" | "removed";

export interface TaskWorktree {
  id: string;
  task_id: string;
  repo_path: string;
  branch_name: string;
  worktree_path: string;
  status: WorktreeStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskReview {
  id: string;
  task_id: string;
  reviewer_agent_id: string | null;
  reviewer_name: string;
  status: ReviewStatus;
  comments: string | null;
  diff_summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostEntry {
  id: string;
  agent_id: string | null;
  task_id: string | null;
  milestone_id: string | null;
  project_id: string | null;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: string;
}

export interface CompletionMetrics {
  id: string;
  task_id: string;
  agent_id: string;
  lines_added: number;
  lines_removed: number;
  files_changed: number;
  tests_added: number;
  tests_passing: number;
  duration_seconds: number;
  created_at: string;
}

export interface AgentPerformance {
  agent_id: string;
  agent_name: string;
  tasks_completed: number;
  total_lines_added: number;
  total_lines_removed: number;
  total_files_changed: number;
  total_tests_added: number;
  avg_duration_seconds: number;
  avg_lines_per_task: number;
  avg_tests_per_task: number;
}

export interface AgentComparison {
  agents: AgentPerformance[];
}

export interface TaskTypeBreakdown {
  priority: string;
  count: number;
  avg_duration_seconds: number;
  avg_lines_added: number;
}

export interface AgentScore {
  agent_id: string;
  agent_name: string;
  score: number;
  speed_score: number;
  quality_score: number;
  cost_score: number;
  familiarity_score: number;
  task_count: number;
}

export interface AgentSuggestion {
  agent: AgentScore;
  confidence: number;
}

export type UserRole = "admin" | "developer" | "viewer";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type WsEventType =
  | "project_created"
  | "project_updated"
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
  | "milestone_achieved"
  | "milestone_completed"
  | "milestone_deleted"
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
  | "daily_stats_recorded"
  | "cost_logged"
  | "metrics_logged"
  | "review_created"
  | "review_updated"
  | "worktree_created"
  | "worktree_updated"
  | "plugins_reloaded";

type WsEventOf<T extends WsEventType, P> = { type: T; payload: P };

export type WsEvent =
  | WsEventOf<"project_created", Project>
  | WsEventOf<"project_updated", Project>
  | WsEventOf<"task_created", Task>
  | WsEventOf<"task_updated", Task>
  | WsEventOf<"task_completed", Task>
  | WsEventOf<"task_assigned", Task>
  | WsEventOf<"task_unassigned", Task>
  | WsEventOf<"agent_registered", Agent>
  | WsEventOf<"agent_activity", ActivityEntry>
  | WsEventOf<"blocker_reported", Blocker>
  | WsEventOf<"blocker_resolved", Blocker>
  | WsEventOf<"milestone_created", Milestone>
  | WsEventOf<"milestone_updated", Milestone>
  | WsEventOf<"milestone_achieved", Milestone>
  | WsEventOf<"milestone_completed", Milestone>
  | WsEventOf<"milestone_deleted", Milestone>
  | WsEventOf<"tag_created", Tag>
  | WsEventOf<"tag_added", TaskTag>
  | WsEventOf<"tag_removed", TaskTag>
  | WsEventOf<"dependency_added", TaskDependency>
  | WsEventOf<"dependency_removed", TaskDependency>
  | WsEventOf<"session_started", AgentSession>
  | WsEventOf<"session_ended", AgentSession>
  | WsEventOf<"comment_added", TaskComment>
  | WsEventOf<"file_lock_acquired", AgentFileLock>
  | WsEventOf<"file_conflict_detected", FileConflict>
  | WsEventOf<"notification_created", AppNotification>
  | WsEventOf<"daily_stats_recorded", MilestoneDailyStats>
  | WsEventOf<"cost_logged", CostEntry>
  | WsEventOf<"metrics_logged", CompletionMetrics>
  | WsEventOf<"review_created", TaskReview>
  | WsEventOf<"review_updated", TaskReview>
  | WsEventOf<"worktree_created", TaskWorktree>
  | WsEventOf<"worktree_updated", TaskWorktree>;

// ─── Executive Summary ────────────────────────────────────────────────────────

export interface MilestoneHealth {
  id: string;
  name: string;
  target_date: string | null;
  task_count: number;
  completed_count: number;
  completion_pct: number;
  health: "on_track" | "at_risk" | "behind";
}

export interface TeamUtilization { total: number; active: number; idle: number; offline: number; }
export interface BlockersSummary { open_count: number; avg_resolution_seconds: number | null; }
export interface TaskVelocity { this_week: number; last_week: number; trend_pct: number | null; }
export interface CostTrendEntry { date: string; cost_usd: number; }
export interface CostOverview { total_cost_usd: number; last_7_days_cost_usd: number; daily_trend: CostTrendEntry[]; }

export interface ExecutiveSummary {
  project_id: string;
  project_name: string;
  milestone_health: MilestoneHealth[];
  team_utilization: TeamUtilization;
  blockers: BlockersSummary;
  velocity: TaskVelocity;
  costs: CostOverview;
  generated_at: string;
}
