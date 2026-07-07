import { useMemo } from "react";
import type { Project, Task, Milestone, Agent, ActivityEntry, Blocker, TaskDependency, AgentSession, MilestoneProgress, TaskComment, AppNotification, AgentStats, AgentContribution, MilestoneDailyStats, ActivityHeatmapEntry, AgentPerformance, AgentComparison, TaskTypeBreakdown, TaskWorktree, WorktreeStatus } from "../types";

function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
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
  spend_today: number;
  tasks_completed_today: number;
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
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "progress" | "milestone_id" | "assigned_agent_id" | "due_date" | "start_date" | "estimate">>
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

async function getProjectTaskDependencies(projectId: string): Promise<TaskDependency[]> {
  const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/task-dependencies`);
  if (!res.ok) await throwApiError(res, "getProjectTaskDependencies");
  return res.json();
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
  const query = qs ? `?${qs}` : "";
  const res = await apiFetch(`/api/activity-stream${query}`);
  if (!res.ok) await throwApiError(res, "getActivityStream");
  return res.json();
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
    getProjectTaskDependencies,
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
  }), []);
}
