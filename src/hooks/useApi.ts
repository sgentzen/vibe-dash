import { useMemo } from "react";
import type { Project, Task, Milestone, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, AgentSession, MilestoneProgress, TaskComment, AppNotification, AgentStats, AgentContribution, MilestoneDailyStats, ActivityHeatmapEntry, Webhook, AgentPerformance, AgentComparison, TaskTypeBreakdown, TaskReview, ReviewStatus, TaskWorktree, WorktreeStatus, GitIntegrationSafe, GitSyncResult, IngestionSource, IngestionSourceKind } from "../types";
import type { ExecutiveSummary, ScoredMatch } from "../../shared/types.js";

const SESSION_KEY = "vibe-dash-api-key";

export function getStoredApiKey(): string | null {
  const v = sessionStorage.getItem(SESSION_KEY);
  return v ? atob(v) : null;
}

export function setStoredApiKey(key: string | null): void {
  if (key) sessionStorage.setItem(SESSION_KEY, btoa(key));
  else sessionStorage.removeItem(SESSION_KEY);
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

/**
 * Error thrown by API wrappers when the server responds with non-2xx.
 * Carries the HTTP status and `Retry-After` (in ms) so callers can
 * back off intelligently on 429 / 503.
 */
export class ApiError extends Error {
  status: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, retryAfterMs: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(res: Response): number | null {
  const h = res.headers.get("Retry-After");
  if (!h) return null;
  // Retry-After can be seconds or an HTTP-date. Prefer seconds.
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const date = Date.parse(h);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

async function throwApiError(res: Response, op: string): Promise<never> {
  throw new ApiError(`${op} failed: ${res.status}`, res.status, parseRetryAfter(res));
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.append(k, v);
  }
  return sp.toString();
}

async function getStats(): Promise<{
  projects: number;
  tasks: number;
  activeAgents: number;
  alerts: number;
}> {
  const res = await apiFetch("/api/stats");
  if (!res.ok) await throwApiError(res, "getStats");
  return res.json();
}

async function getProjects(): Promise<Project[]> {
  const res = await apiFetch("/api/projects");
  if (!res.ok) await throwApiError(res, "getProjects");
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
  if (!res.ok) await throwApiError(res, "createProject");
  return res.json();
}

async function getTasks(projectId?: string): Promise<Task[]> {
  const url = projectId
    ? `/api/tasks?project_id=${encodeURIComponent(projectId)}`
    : "/api/tasks";
  const res = await apiFetch(url);
  if (!res.ok) await throwApiError(res, "getTasks");
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
  if (!res.ok) await throwApiError(res, "createTask");
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
  if (!res.ok) await throwApiError(res, "updateTask");
  return res.json();
}

async function completeTask(id: string): Promise<Task> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: jsonHeaders(),
  });
  if (!res.ok) await throwApiError(res, "completeTask");
  return res.json();
}

async function getAgents(): Promise<Agent[]> {
  const res = await apiFetch("/api/agents");
  if (!res.ok) await throwApiError(res, "getAgents");
  return res.json();
}

async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  const res = await apiFetch(`/api/activity?limit=${limit}`);
  if (!res.ok) await throwApiError(res, "getActivity");
  return res.json();
}

async function getBlockers(): Promise<Blocker[]> {
  const res = await apiFetch("/api/blockers");
  if (!res.ok) await throwApiError(res, "getBlockers");
  return res.json();
}

async function getMilestones(projectId?: string): Promise<Milestone[]> {
  const url = projectId
    ? `/api/milestones?project_id=${encodeURIComponent(projectId)}`
    : "/api/milestones";
  const res = await apiFetch(url);
  if (!res.ok) await throwApiError(res, "getMilestones");
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
  if (!res.ok) await throwApiError(res, "createMilestone");
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
  if (!res.ok) await throwApiError(res, "updateMilestone");
  return res.json();
}

async function getTags(projectId: string): Promise<Tag[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tags`);
  if (!res.ok) await throwApiError(res, "getTags");
  return res.json();
}

async function createTag(projectId: string, data: { name: string; color?: string }): Promise<Tag> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/tags`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) await throwApiError(res, "createTag");
  return res.json();
}

async function getTaskTags(taskId: string): Promise<Tag[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`);
  if (!res.ok) await throwApiError(res, "getTaskTags");
  return res.json();
}

async function getProjectTaskTags(projectId: string): Promise<Array<{ task_id: string; tag: Tag }>> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/task-tags`);
  if (!res.ok) await throwApiError(res, "getProjectTaskTags");
  return res.json();
}

async function getProjectTaskDependencies(projectId: string): Promise<TaskDependency[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/task-dependencies`);
  if (!res.ok) await throwApiError(res, "getProjectTaskDependencies");
  return res.json();
}

async function addTagToTask(taskId: string, tagId: string): Promise<TaskTag> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ tag_id: tagId }),
  });
  if (!res.ok) await throwApiError(res, "addTagToTask");
  return res.json();
}

async function removeTagFromTask(taskId: string, tagId: string): Promise<void> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
  if (!res.ok) await throwApiError(res, "removeTagFromTask");
}

// ─── R2: Milestone Progress ─────────────────────────────────────────────

async function getMilestoneProgress(milestoneId: string): Promise<MilestoneProgress> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/progress`);
  if (!res.ok) await throwApiError(res, "getMilestoneProgress");
  return res.json();
}

// ─── R2: Dependencies ────────────────────────────────────────────────────

async function getDependencies(taskId: string): Promise<TaskDependency[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`);
  if (!res.ok) await throwApiError(res, "getDependencies");
  return res.json();
}

async function getBlockingTasks(taskId: string): Promise<Task[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/blocking`);
  if (!res.ok) await throwApiError(res, "getBlockingTasks");
  return res.json();
}

async function addDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDependency> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
  });
  if (!res.ok) await throwApiError(res, "addDependency");
  return res.json();
}

async function removeDependency(depId: string): Promise<void> {
  await apiFetch(`/api/dependencies/${encodeURIComponent(depId)}`, { method: "DELETE" });
}

// ─── R2: Agent Detail ────────────────────────────────────────────────────

async function getAgentDetail(agentId: string): Promise<Agent & { health_status: string; completed_today: number; current_task_title: string | null }> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`);
  if (!res.ok) await throwApiError(res, "getAgentDetail");
  return res.json();
}

async function getAgentActivity(agentId: string, limit = 50): Promise<ActivityEntry[]> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/activity?limit=${limit}`);
  if (!res.ok) await throwApiError(res, "getAgentActivity");
  return res.json();
}

async function getAgentSessions(agentId: string): Promise<AgentSession[]> {
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/sessions`);
  if (!res.ok) await throwApiError(res, "getAgentSessions");
  return res.json();
}

// ─── R2: Search ──────────────────────────────────────────────────────────

async function searchTasks(params: Record<string, string | undefined>): Promise<Task[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/tasks/search?${qs}`);
  if (!res.ok) await throwApiError(res, "searchTasks");
  return res.json();
}

// ─── R3: Comments ────────────────────────────────────────────────────

async function getComments(taskId: string): Promise<TaskComment[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
  if (!res.ok) await throwApiError(res, "getComments");
  return res.json();
}

async function addCommentApi(taskId: string, message: string, authorName: string): Promise<TaskComment> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ message, author_name: authorName }),
  });
  if (!res.ok) await throwApiError(res, "addComment");
  return res.json();
}

// ─── 5.4: Code Reviews ──────────────────────────────────────────────────

async function getReviews(taskId: string): Promise<TaskReview[]> {
  const res = await apiFetch(`/api/tasks/${encodeURIComponent(taskId)}/reviews`);
  if (!res.ok) await throwApiError(res, "getReviews");
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
  if (!res.ok) await throwApiError(res, "createReview");
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
  if (!res.ok) await throwApiError(res, "updateReview");
  return res.json();
}

// ─── R3: Notifications ──────────────────────────────────────────────

async function getNotifications(limit = 50): Promise<AppNotification[]> {
  const res = await apiFetch(`/api/notifications?limit=${limit}`);
  if (!res.ok) await throwApiError(res, "getNotifications");
  return res.json();
}

async function getUnreadCount(): Promise<number> {
  const res = await apiFetch("/api/notifications/unread-count");
  if (!res.ok) await throwApiError(res, "getUnreadCount");
  const data = await res.json();
  return data.count;
}

async function markNotificationReadApi(id: string): Promise<void> {
  await apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
}

async function markAllRead(): Promise<void> {
  await apiFetch("/api/notifications/mark-all-read", { method: "POST" });
}

// ─── R3: Bulk Update ────────────────────────────────────────────────

async function bulkUpdateTasks(taskIds: string[], updates: Record<string, unknown>): Promise<{ updated: number; tasks: Task[] }> {
  const res = await apiFetch("/api/tasks/bulk", {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ task_ids: taskIds, updates }),
  });
  if (!res.ok) await throwApiError(res, "bulkUpdateTasks");
  return res.json();
}

// ─── R4: Agent Stats ─────────────────────────────────────────────────

async function getAgentStats(agentId: string, milestoneId?: string): Promise<AgentStats> {
  const qs = milestoneId ? `?milestone_id=${encodeURIComponent(milestoneId)}` : "";
  const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/stats${qs}`);
  if (!res.ok) await throwApiError(res, "getAgentStats");
  return res.json();
}

async function getMilestoneContributions(milestoneId: string): Promise<AgentContribution[]> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/contributions`);
  if (!res.ok) await throwApiError(res, "getMilestoneContributions");
  return res.json();
}

// ─── R4: Milestone Daily Stats ───────────────────────────────────────────

async function getMilestoneDailyStats(milestoneId: string): Promise<MilestoneDailyStats[]> {
  const res = await apiFetch(`/api/milestones/${encodeURIComponent(milestoneId)}/daily-stats`);
  if (!res.ok) await throwApiError(res, "getMilestoneDailyStats");
  return res.json();
}

// ─── R4: Heatmap & Reports ──────────────────────────────────────────

async function getActivityHeatmap(projectId?: string): Promise<ActivityHeatmapEntry[]> {
  const url = projectId ? `/api/activity-heatmap?project_id=${encodeURIComponent(projectId)}` : "/api/activity-heatmap";
  const res = await apiFetch(url);
  if (!res.ok) await throwApiError(res, "getActivityHeatmap");
  return res.json();
}

// ─── R5: Activity Stream ─────────────────────────────────────────────

async function getActivityStreamApi(params: Record<string, string | undefined> = {}): Promise<ActivityEntry[]> {
  const qs = buildQueryString(params);
  const res = await apiFetch(`/api/activity-stream${qs ? `?${qs}` : ""}`);
  if (!res.ok) await throwApiError(res, "getActivityStream");
  return res.json();
}

// ─── R6: Webhooks ────────────────────────────────────────────────────

async function getWebhooks(): Promise<Webhook[]> {
  const res = await apiFetch("/api/webhooks");
  if (!res.ok) await throwApiError(res, "getWebhooks");
  return res.json();
}

async function createWebhookApi(url: string, eventTypes: string[]): Promise<Webhook> {
  const res = await apiFetch("/api/webhooks", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ url, event_types: eventTypes }),
  });
  if (!res.ok) await throwApiError(res, "createWebhook");
  return res.json();
}

async function updateWebhookApi(id: string, updates: { url?: string; event_types?: string[]; active?: boolean }): Promise<Webhook> {
  const res = await apiFetch(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) await throwApiError(res, "updateWebhook");
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
  const qs = buildQueryString({ ...params, groupBy: "day" });
  const res = await apiFetch(`/api/costs?${qs}`);
  if (!res.ok) await throwApiError(res, "getCostTimeseries");
  return res.json();
}

async function getCostSummary(projectId?: string): Promise<CostSummary> {
  const qs = projectId
    ? buildQueryString({ groupBy: "project", id: projectId })
    : "groupBy=global";
  const res = await apiFetch(`/api/costs?${qs}`);
  if (!res.ok) await throwApiError(res, "getCostSummary");
  return res.json();
}

async function getProjectCostSummary(projectId: string): Promise<CostSummary> {
  const res = await apiFetch(`/api/costs?groupBy=project&id=${encodeURIComponent(projectId)}`);
  if (!res.ok) await throwApiError(res, "getProjectCostSummary");
  return res.json();
}

async function getCostByModel(params: Record<string, string | undefined> = {}): Promise<CostByModelEntry[]> {
  const qs = buildQueryString({ ...params, groupBy: "model" });
  const res = await apiFetch(`/api/costs?${qs}`);
  if (!res.ok) await throwApiError(res, "getCostByModel");
  return res.json();
}

async function getCostByAgent(params: Record<string, string | undefined> = {}): Promise<CostByAgentEntry[]> {
  const qs = buildQueryString({ ...params, groupBy: "agent" });
  const res = await apiFetch(`/api/costs?${qs}`);
  if (!res.ok) await throwApiError(res, "getCostByAgent");
  return res.json();
}

// ─── Agent Performance Metrics ────────────────────────────────────────

async function getAgentPerformance(agentId: string): Promise<AgentPerformance> {
  const res = await apiFetch(`/api/agents/${agentId}/performance`);
  if (!res.ok) await throwApiError(res, "getAgentPerformance");
  return res.json();
}

async function getAgentComparison(): Promise<AgentComparison> {
  const res = await apiFetch("/api/agents/comparison");
  if (!res.ok) await throwApiError(res, "getAgentComparison");
  return res.json();
}

async function getTaskTypeBreakdown(agentId: string): Promise<TaskTypeBreakdown[]> {
  const res = await apiFetch(`/api/agents/${agentId}/task-type-breakdown`);
  if (!res.ok) await throwApiError(res, "getTaskTypeBreakdown");
  return res.json();
}

// ─── Executive Summary ────────────────────────────────────────────────
export type { ExecutiveSummary } from "../../shared/types.js";

async function getExecutiveSummary(projectId: string): Promise<ExecutiveSummary> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/executive-summary`);
  if (!res.ok) await throwApiError(res, "getExecutiveSummary");
  return res.json();
}

// ─── Worktrees ────────────────────────────────────────────────────────

async function getWorktrees(): Promise<TaskWorktree[]> {
  const res = await apiFetch("/api/worktrees");
  if (!res.ok) await throwApiError(res, "getWorktrees");
  return res.json();
}

async function updateWorktreeStatus(id: string, status: WorktreeStatus): Promise<TaskWorktree> {
  const res = await apiFetch(`/api/worktrees/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) await throwApiError(res, "updateWorktreeStatus");
  return res.json();
}

// ─── WS Ticket ───────────────────────────────────────────────────────────────

export async function getWsTicket(): Promise<string | null> {
  try {
    const res = await apiFetch("/api/ws-ticket", { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { ticket: string }).ticket ?? null;
  } catch {
    return null;
  }
}


// ─── Auth ─────────────────────────────────────────────────────────────────────

import type { User } from "../types";

interface AuthStatus {
  auth_enabled: boolean;
  team_mode: boolean;
}

async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status"); // no auth header — public endpoint
  if (!res.ok) await throwApiError(res, "getAuthStatus");
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
  if (!res.ok) await throwApiError(res, "listUsers");
  return res.json();
}

async function updateUserRoleApi(id: string, role: string): Promise<User> {
  const res = await apiFetch(`/api/users/${encodeURIComponent(id)}/role`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ role }),
  });
  if (!res.ok) await throwApiError(res, "updateUserRole");
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
  if (!res.ok) await throwApiError(res, "rotateKey");
  return res.json();
}

// ─── Git Sync ─────────────────────────────────────────────────────────────────

async function getGitIntegrations(projectId?: string): Promise<GitIntegrationSafe[]> {
  const url = projectId ? `/api/git/integrations?project_id=${encodeURIComponent(projectId)}` : "/api/git/integrations";
  const res = await apiFetch(url);
  if (!res.ok) await throwApiError(res, "getGitIntegrations");
  return res.json();
}

async function addGitIntegration(data: { project_id: string; provider: string; owner: string; repo: string; token: string; auto_sync?: boolean }): Promise<GitIntegrationSafe> {
  const res = await apiFetch("/api/git/integrations", { method: "POST", headers: jsonHeaders(), body: JSON.stringify(data) });
  if (!res.ok) await throwApiError(res, "addGitIntegration");
  return res.json();
}

async function deleteGitIntegration(id: string): Promise<void> {
  const res = await apiFetch(`/api/git/integrations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "deleteGitIntegration");
}

async function syncGitIntegration(id: string): Promise<GitSyncResult> {
  const res = await apiFetch(`/api/git/integrations/${encodeURIComponent(id)}/sync`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "syncGitIntegration");
  return res.json();
}

// ─── Ingestion ────────────────────────────────────────────────────────────────

async function listIngestionSources(): Promise<IngestionSource[]> {
  const res = await apiFetch("/api/ingest/sources");
  if (!res.ok) await throwApiError(res, "listIngestionSources");
  return res.json();
}

async function createIngestionSource(name: string, kind: IngestionSourceKind, project_id?: string | null): Promise<IngestionSource & { token: string }> {
  const res = await apiFetch("/api/ingest/sources", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ name, kind, project_id }) });
  if (!res.ok) await throwApiError(res, "createIngestionSource");
  return res.json();
}

async function deleteIngestionSource(id: string): Promise<void> {
  const res = await apiFetch(`/api/ingest/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) await throwApiError(res, "deleteIngestionSource");
}

async function rotateIngestionToken(id: string): Promise<{ token: string }> {
  const res = await apiFetch(`/api/ingest/sources/${encodeURIComponent(id)}/rotate`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "rotateIngestionToken");
  return res.json();
}

async function getDetectorMatches(opts?: { minScore?: number; detectorId?: string }): Promise<ScoredMatch[]> {
  const params = new URLSearchParams();
  if (opts?.minScore !== undefined) params.set("minScore", String(opts.minScore));
  if (opts?.detectorId) params.set("detectorId", opts.detectorId);
  const qs = params.size > 0 ? `?${params}` : "";
  const res = await apiFetch(`/api/detectors/matches${qs}`);
  if (!res.ok) await throwApiError(res, "getDetectorMatches");
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
    getNotifications,
    getUnreadCount,
    markNotificationRead: markNotificationReadApi,
    markAllRead,
    bulkUpdateTasks,
    getAgentStats,
    getMilestoneContributions,
    getMilestoneDailyStats,
    getActivityHeatmap,
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
    getGitIntegrations,
    addGitIntegration,
    deleteGitIntegration,
    syncGitIntegration,
    listIngestionSources,
    createIngestionSource: (name: string, kind: IngestionSourceKind, project_id?: string | null) => createIngestionSource(name, kind, project_id),
    deleteIngestionSource,
    rotateIngestionToken,
    getDetectorMatches,
    getWsTicket,
  }), []);
}
