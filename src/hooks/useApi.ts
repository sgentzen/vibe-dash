import { useMemo } from "react";
import type { Project, Task, Milestone, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, AgentSession, SavedFilter, MilestoneProgress, TaskComment, FileConflict, AlertRule, AppNotification, AgentStats, AgentContribution, MilestoneDailyStats, ActivityHeatmapEntry, ProjectTemplate, Webhook, AgentPerformance, AgentComparison, TaskTypeBreakdown, TaskReview, ReviewStatus, AgentSuggestion, TaskWorktree, WorktreeStatus } from "../types";
import type { ExecutiveSummary } from "../../shared/types.js";

const API_KEY_STORAGE = "vibe-dash-api-key";

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE);
}

export function setStoredApiKey(key: string | null): void {
  if (key) localStorage.setItem(API_KEY_STORAGE, key);
  else localStorage.removeItem(API_KEY_STORAGE);
}

function authHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders() };
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
}

function buildQueryString(params: Record<string, string | undefined>): string {
  return Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
}

async function getStats(): Promise<{
  projects: number;
  tasks: number;
  activeAgents: number;
  alerts: number;
}> {
  const res = await apiFetch("/api/stats");
  if (!res.ok) throw new Error(`getStats failed: ${res.status}`);
  return res.json();
}

async function getProjects(): Promise<Project[]> {
  const res = await apiFetch("/api/projects");
  if (!res.ok) throw new Error(`getProjects failed: ${res.status}`);
  return res.json();
}

async function createProject(data: {
  name: string;
  description?: string;
}): Promise<Project> {
  const res = await apiFetch("/api/projects", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return res.json();
}

async function getTasks(projectId?: string): Promise<Task[]> {
  const url = projectId
    ? `/api/tasks?project_id=${encodeURIComponent(projectId)}`
    : "/api/tasks";
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`getTasks failed: ${res.status}`);
  return res.json();
}

async function createTask(data: {
  project_id: string;
  title: string;
  description?: string;
  priority?: string;
  parent_task_id?: string;
}): Promise<Task> {
  const res = await apiFetch("/api/tasks", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

async function updateTask(
  id: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "progress" | "milestone_id" | "assigned_agent_id" | "due_date" | "start_date" | "estimate" | "recurrence_rule">>
): Promise<Task> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateTask failed: ${res.status}`);
  return res.json();
}

async function completeTask(id: string): Promise<Task> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: jsonHeaders(),
  });
  if (!res.ok) throw new Error(`completeTask failed: ${res.status}`);
  return res.json();
}

async function getAgents(): Promise<Agent[]> {
  const res = await apiFetch("/api/agents");
  if (!res.ok) throw new Error(`getAgents failed: ${res.status}`);
  return res.json();
}

async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  const res = await apiFetch(`/api/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`getActivity failed: ${res.status}`);
  return res.json();
}

async function getBlockers(): Promise<Blocker[]> {
  const res = await apiFetch("/api/blockers");
  if (!res.ok) throw new Error(`getBlockers failed: ${res.status}`);
  return res.json();
}

async function getMilestones(projectId?: string): Promise<Milestone[]> {
  const url = projectId
    ? `/api/milestones?project_id=${encodeURIComponent(projectId)}`
    : "/api/milestones";
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`getMilestones failed: ${res.status}`);
  return res.json();
}

async function createMilestone(data: {
  project_id: string;
  name: string;
  description?: string;
  acceptance_criteria?: string;
  target_date?: string;
  status?: string;
}): Promise<Milestone> {
  const res = await apiFetch("/api/milestones", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createMilestone failed: ${res.status}`);
  return res.json();
}

async function updateMilestone(
  id: string,
  data: Partial<Pick<Milestone, "name" | "description" | "acceptance_criteria" | "status" | "target_date">>
): Promise<Milestone> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateMilestone failed: ${res.status}`);
  return res.json();
}

async function getTags(projectId: string): Promise<Tag[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tags`);
  if (!res.ok) throw new Error(`getTags failed: ${res.status}`);
  return res.json();
}

async function createTag(projectId: string, data: { name: string; color?: string }): Promise<Tag> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tags`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createTag failed: ${res.status}`);
  return res.json();
}

async function getTaskTags(taskId: string): Promise<Tag[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`);
  if (!res.ok) throw new Error(`getTaskTags failed: ${res.status}`);
  return res.json();
}

async function getProjectTaskTags(projectId: string): Promise<Array<{ task_id: string; tag: Tag }>> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/task-tags`);
  if (!res.ok) throw new Error(`getProjectTaskTags failed: ${res.status}`);
  return res.json();
}

async function getProjectTaskDependencies(projectId: string): Promise<TaskDependency[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/task-dependencies`);
  if (!res.ok) throw new Error(`getProjectTaskDependencies failed: ${res.status}`);
  return res.json();
}

async function addTagToTask(taskId: string, tagId: string): Promise<TaskTag> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ tag_id: tagId }),
  });
  if (!res.ok) throw new Error(`addTagToTask failed: ${res.status}`);
  return res.json();
}

async function removeTagFromTask(taskId: string, tagId: string): Promise<void> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`removeTagFromTask failed: ${res.status}`);
}

// ─── R2: Milestone Progress ─────────────────────────────────────────────

async function getMilestoneProgress(milestoneId: string): Promise<MilestoneProgress> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/progress`);
  if (!res.ok) throw new Error(`getMilestoneProgress failed: ${res.status}`);
  return res.json();
}

// ─── R2: Dependencies ────────────────────────────────────────────────────

async function getDependencies(taskId: string): Promise<TaskDependency[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`);
  if (!res.ok) throw new Error(`getDependencies failed: ${res.status}`);
  return res.json();
}

async function getBlockingTasks(taskId: string): Promise<Task[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/blocking`);
  if (!res.ok) throw new Error(`getBlockingTasks failed: ${res.status}`);
  return res.json();
}

async function addDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDependency> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
  });
  if (!res.ok) throw new Error(`addDependency failed: ${res.status}`);
  return res.json();
}

async function removeDependency(depId: string): Promise<void> {
  await apiFetch(`/api/dependencies/${encodeURIComponent(depId)}`, { method: "DELETE" });
}

// ─── R2: Agent Detail ────────────────────────────────────────────────────

async function getAgentDetail(agentId: string): Promise<Agent & { health_status: string; completed_today: number; current_task_title: string | null }> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`);
  if (!res.ok) throw new Error(`getAgentDetail failed: ${res.status}`);
  return res.json();
}

async function getAgentActivity(agentId: string, limit = 50): Promise<ActivityEntry[]> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`getAgentActivity failed: ${res.status}`);
  return res.json();
}

async function getAgentSessions(agentId: string): Promise<AgentSession[]> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/sessions`);
  if (!res.ok) throw new Error(`getAgentSessions failed: ${res.status}`);
  return res.json();
}

// ─── R2: Search ──────────────────────────────────────────────────────────

async function searchTasks(params: Record<string, string | undefined>): Promise<Task[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/tasks/search?${qs}`);
  if (!res.ok) throw new Error(`searchTasks failed: ${res.status}`);
  return res.json();
}

async function getSavedFilters(): Promise<SavedFilter[]> {
  const res = await apiFetch("/api/filters");
  if (!res.ok) throw new Error(`getSavedFilters failed: ${res.status}`);
  return res.json();
}

async function createSavedFilter(name: string, filterJson: string): Promise<SavedFilter> {
  const res = await apiFetch("/api/filters", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name, filter_json: filterJson }),
  });
  if (!res.ok) throw new Error(`createSavedFilter failed: ${res.status}`);
  return res.json();
}

async function deleteSavedFilter(id: string): Promise<void> {
  await apiFetch(`/api/filters/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── R3: Comments ────────────────────────────────────────────────────

async function getComments(taskId: string): Promise<TaskComment[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
  if (!res.ok) throw new Error(`getComments failed: ${res.status}`);
  return res.json();
}

async function addCommentApi(taskId: string, message: string, authorName: string): Promise<TaskComment> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ message, author_name: authorName }),
  });
  if (!res.ok) throw new Error(`addComment failed: ${res.status}`);
  return res.json();
}

// ─── 5.4: Code Reviews ──────────────────────────────────────────────────

async function getReviews(taskId: string): Promise<TaskReview[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/reviews`);
  if (!res.ok) throw new Error(`getReviews failed: ${res.status}`);
  return res.json();
}

async function createReviewApi(taskId: string, input: {
  reviewer_name: string;
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}): Promise<TaskReview> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/reviews`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`createReview failed: ${res.status}`);
  return res.json();
}

async function updateReviewApi(reviewId: string, patch: {
  status?: ReviewStatus;
  comments?: string | null;
  diff_summary?: string | null;
}): Promise<TaskReview> {
  const res = await apiFetch(`/api/reviews/${encodeURIComponent(reviewId)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`updateReview failed: ${res.status}`);
  return res.json();
}

// ─── R3: File Locks ──────────────────────────────────────────────────

async function getFileConflicts(): Promise<FileConflict[]> {
  const res = await apiFetch("/api/file-locks/conflicts");
  if (!res.ok) throw new Error(`getFileConflicts failed: ${res.status}`);
  return res.json();
}

// ─── R3: Notifications ──────────────────────────────────────────────

async function getNotifications(limit = 50): Promise<AppNotification[]> {
  const res = await apiFetch(`/api/notifications?limit=${limit}`);
  if (!res.ok) throw new Error(`getNotifications failed: ${res.status}`);
  return res.json();
}

async function getUnreadCount(): Promise<number> {
  const res = await apiFetch("/api/notifications/unread-count");
  if (!res.ok) throw new Error(`getUnreadCount failed: ${res.status}`);
  const data = await res.json();
  return data.count;
}

async function markNotificationReadApi(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
}

async function markAllRead(): Promise<void> {
  await apiFetch("/api/notifications/mark-all-read", { method: "POST" });
}

// ─── R3: Alert Rules ────────────────────────────────────────────────

async function getAlertRules(): Promise<AlertRule[]> {
  const res = await apiFetch("/api/alert-rules");
  if (!res.ok) throw new Error(`getAlertRules failed: ${res.status}`);
  return res.json();
}

async function createAlertRule(eventType: string, filterJson?: string): Promise<AlertRule> {
  const res = await apiFetch("/api/alert-rules", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ event_type: eventType, filter_json: filterJson }),
  });
  if (!res.ok) throw new Error(`createAlertRule failed: ${res.status}`);
  return res.json();
}

// ─── R3: Bulk Update ────────────────────────────────────────────────

async function bulkUpdateTasks(taskIds: string[], updates: Record<string, unknown>): Promise<{ updated: number; tasks: Task[] }> {
  const res = await apiFetch("/api/tasks/bulk", {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ task_ids: taskIds, updates }),
  });
  if (!res.ok) throw new Error(`bulkUpdateTasks failed: ${res.status}`);
  return res.json();
}

// ─── R4: Agent Stats ─────────────────────────────────────────────────

async function getAgentStats(agentId: string, milestoneId?: string): Promise<AgentStats> {
  const qs = milestoneId ? `?milestone_id=${encodeURIComponent(milestoneId)}` : "";
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/stats${qs}`);
  if (!res.ok) throw new Error(`getAgentStats failed: ${res.status}`);
  return res.json();
}

async function getMilestoneContributions(milestoneId: string): Promise<AgentContribution[]> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/contributions`);
  if (!res.ok) throw new Error(`getMilestoneContributions failed: ${res.status}`);
  return res.json();
}

// ─── R4: Milestone Daily Stats ───────────────────────────────────────────

async function getMilestoneDailyStats(milestoneId: string): Promise<MilestoneDailyStats[]> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/daily-stats`);
  if (!res.ok) throw new Error(`getMilestoneDailyStats failed: ${res.status}`);
  return res.json();
}

// ─── R4: Heatmap & Reports ──────────────────────────────────────────

async function getActivityHeatmap(projectId?: string): Promise<ActivityHeatmapEntry[]> {
  const url = projectId ? `/api/activity-heatmap?project_id=${encodeURIComponent(projectId)}` : "/api/activity-heatmap";
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`getActivityHeatmap failed: ${res.status}`);
  return res.json();
}

async function generateReportApi(projectId: string, period: "day" | "week" | "milestone"): Promise<string> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/report`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ period }),
  });
  if (!res.ok) throw new Error(`generateReport failed: ${res.status}`);
  const data = await res.json();
  return data.report;
}

// ─── R5: Templates ───────────────────────────────────────────────────

async function getTemplates(): Promise<ProjectTemplate[]> {
  const res = await apiFetch("/api/templates");
  if (!res.ok) throw new Error(`getTemplates failed: ${res.status}`);
  return res.json();
}

async function instantiateTemplate(templateId: string, projectName: string): Promise<Project> {
  const res = await apiFetch(`/api/templates/${encodeURIComponent(templateId)}/instantiate`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ project_name: projectName }),
  });
  if (!res.ok) throw new Error(`instantiateTemplate failed: ${res.status}`);
  return res.json();
}

// ─── R5: Activity Stream ─────────────────────────────────────────────

async function getActivityStreamApi(params: Record<string, string | undefined> = {}): Promise<ActivityEntry[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/activity-stream${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getActivityStream failed: ${res.status}`);
  return res.json();
}

// ─── R6: Webhooks ────────────────────────────────────────────────────

async function getWebhooks(): Promise<Webhook[]> {
  const res = await apiFetch("/api/webhooks");
  if (!res.ok) throw new Error(`getWebhooks failed: ${res.status}`);
  return res.json();
}

async function createWebhookApi(url: string, eventTypes: string[]): Promise<Webhook> {
  const res = await apiFetch("/api/webhooks", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ url, event_types: eventTypes }),
  });
  if (!res.ok) throw new Error(`createWebhook failed: ${res.status}`);
  return res.json();
}

async function updateWebhookApi(id: string, updates: { url?: string; event_types?: string[]; active?: boolean }): Promise<Webhook> {
  const res = await apiFetch(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`updateWebhook failed: ${res.status}`);
  return res.json();
}

async function deleteWebhookApi(id: string): Promise<void> {
  await apiFetch(`/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Cost & Token Tracking ──────────────────────────────────────────

interface CostSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

export interface CostTimeseriesEntry {
  date: string;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

interface CostByModelEntry {
  model: string;
  provider: string;
  total_cost_usd: number;
  total_tokens: number;
  entry_count: number;
}

interface CostByAgentEntry {
  agent_id: string;
  agent_name: string;
  total_cost_usd: number;
  total_tokens: number;
  entry_count: number;
}

async function getCostTimeseries(params: Record<string, string | undefined> = {}): Promise<CostTimeseriesEntry[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/costs/timeseries${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostTimeseries failed: ${res.status}`);
  return res.json();
}

async function getCostSummary(projectId?: string): Promise<CostSummary> {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const res = await apiFetch(`/api/costs/summary${qs}`);
  if (!res.ok) throw new Error(`getCostSummary failed: ${res.status}`);
  return res.json();
}

async function getProjectCostSummary(projectId: string): Promise<CostSummary> {
  const res = await apiFetch(`/api/costs/project/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`getProjectCostSummary failed: ${res.status}`);
  return res.json();
}

async function getCostByModel(params: Record<string, string | undefined> = {}): Promise<CostByModelEntry[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/costs/by-model${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostByModel failed: ${res.status}`);
  return res.json();
}

async function getCostByAgent(params: Record<string, string | undefined> = {}): Promise<CostByAgentEntry[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/costs/by-agent${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostByAgent failed: ${res.status}`);
  return res.json();
}

// ─── Agent Performance Metrics ────────────────────────────────────────

async function getAgentPerformance(agentId: string): Promise<AgentPerformance> {
  const res = await apiFetch(`/api/agents/${agentId}/performance`);
  if (!res.ok) throw new Error(`getAgentPerformance failed: ${res.status}`);
  return res.json();
}

async function getAgentComparison(): Promise<AgentComparison> {
  const res = await apiFetch("/api/agents/comparison");
  if (!res.ok) throw new Error(`getAgentComparison failed: ${res.status}`);
  return res.json();
}

async function getTaskTypeBreakdown(agentId: string): Promise<TaskTypeBreakdown[]> {
  const res = await apiFetch(`/api/agents/${agentId}/task-type-breakdown`);
  if (!res.ok) throw new Error(`getTaskTypeBreakdown failed: ${res.status}`);
  return res.json();
}

// ─── Executive Summary ────────────────────────────────────────────────
export type { ExecutiveSummary } from "../../shared/types.js";

async function getExecutiveSummary(projectId: string): Promise<ExecutiveSummary> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/executive-summary`);
  if (!res.ok) throw new Error(`getExecutiveSummary failed: ${res.status}`);
  return res.json();
}

// ─── Worktrees ────────────────────────────────────────────────────────

async function getWorktrees(): Promise<TaskWorktree[]> {
  const res = await apiFetch("/api/worktrees");
  if (!res.ok) throw new Error(`getWorktrees failed: ${res.status}`);
  return res.json();
}

async function updateWorktreeStatus(id: string, status: WorktreeStatus): Promise<TaskWorktree> {
  const res = await apiFetch(`/api/worktrees/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`updateWorktreeStatus failed: ${res.status}`);
  return res.json();
}

async function getSuggestedAgent(taskId: string): Promise<AgentSuggestion | null> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/suggest-agent`);
  if (!res.ok) throw new Error(`getSuggestedAgent failed: ${res.status}`);
  const data = await res.json();
  return data ?? null;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

import type { User } from "../types";

interface AuthStatus {
  auth_enabled: boolean;
}

async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status"); // no auth header — public endpoint
  if (!res.ok) throw new Error(`getAuthStatus failed: ${res.status}`);
  return res.json();
}

async function validateApiKey(key: string): Promise<User> {
  const res = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error("Invalid API key");
  return res.json();
}

async function createUserApi(data: { name: string; email: string; role?: string }): Promise<{ user: User; api_key: string }> {
  const res = await apiFetch("/api/users", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error((err as { error?: string }).error ?? "createUser failed");
  }
  return res.json();
}

async function listUsersApi(): Promise<User[]> {
  const res = await apiFetch("/api/users");
  if (!res.ok) throw new Error(`listUsers failed: ${res.status}`);
  return res.json();
}

async function updateUserRoleApi(id: string, role: string): Promise<User> {
  const res = await apiFetch(`/api/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`updateUserRole failed: ${res.status}`);
  return res.json();
}

async function deleteUserApi(id: string): Promise<void> {
  await apiFetch(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

async function rotateKeyApi(id: string): Promise<{ user: User; api_key: string }> {
  const res = await apiFetch(`/api/users/${encodeURIComponent(id)}/rotate-key`, {
    method: "POST",
    headers: jsonHeaders(),
  });
  if (!res.ok) throw new Error(`rotateKey failed: ${res.status}`);
  return res.json();
}

export function useApi() {
  return useMemo(() => ({
    getStats,
    getProjects,
    createProject,
    getTasks,
    createTask,
    updateTask,
    completeTask,
    getAgents,
    getActivity,
    getBlockers,
    getMilestones,
    createMilestone,
    updateMilestone,
    getTags,
    createTag,
    getTaskTags,
    getProjectTaskTags,
    getProjectTaskDependencies,
    addTagToTask,
    removeTagFromTask,
    getMilestoneProgress,
    getDependencies,
    getBlockingTasks,
    addDependency,
    removeDependency,
    getAgentDetail,
    getAgentActivity,
    getAgentSessions,
    searchTasks,
    getComments,
    addComment: addCommentApi,
    getReviews,
    createReview: createReviewApi,
    updateReview: updateReviewApi,
    getFileConflicts,
    getNotifications,
    getUnreadCount,
    markNotificationRead: markNotificationReadApi,
    markAllRead,
    getAlertRules,
    createAlertRule,
    bulkUpdateTasks,
    getAgentStats,
    getMilestoneContributions,
    getMilestoneDailyStats,
    getActivityHeatmap,
    generateReport: generateReportApi,
    getTemplates,
    instantiateTemplate,
    getActivityStream: getActivityStreamApi,
    getWebhooks,
    createWebhook: createWebhookApi,
    updateWebhook: updateWebhookApi,
    deleteWebhook: deleteWebhookApi,
    getCostTimeseries,
    getProjectCostSummary,
    getCostSummary,
    getCostByModel,
    getCostByAgent,
    getAgentPerformance,
    getAgentComparison,
    getTaskTypeBreakdown,
    getSuggestedAgent,
    getWorktrees,
    updateWorktreeStatus,
    getExecutiveSummary,
    getAuthStatus,
    validateApiKey,
    createUser: createUserApi,
    listUsers: listUsersApi,
    updateUserRole: updateUserRoleApi,
    deleteUser: deleteUserApi,
    rotateKey: rotateKeyApi,
  }), []);
}
