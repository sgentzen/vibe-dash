import { useMemo } from "react";
import type { Project, Task, Milestone, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, AgentSession, SavedFilter, MilestoneProgress, TaskComment, FileConflict, AlertRule, AppNotification, AgentStats, AgentContribution, MilestoneDailyStats, ActivityHeatmapEntry, ProjectTemplate, Webhook } from "../types";

const JSON_HEADERS = { "Content-Type": "application/json" };

function buildQueryString(params: Record<string, string | undefined>): string {
  return Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
}

async function getStats(): Promise<{
  projects: number;
  tasks: number;
  activeAgents: number;
  alerts: number;
}> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error(`getStats failed: ${res.status}`);
  return res.json();
}

async function getProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error(`getProjects failed: ${res.status}`);
  return res.json();
}

async function createProject(data: {
  name: string;
  description?: string;
}): Promise<Project> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createProject failed: ${res.status}`);
  return res.json();
}

async function getTasks(projectId?: string): Promise<Task[]> {
  const url = projectId
    ? `/api/tasks?project_id=${encodeURIComponent(projectId)}`
    : "/api/tasks";
  const res = await fetch(url);
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
  const res = await fetch("/api/tasks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return res.json();
}

async function updateTask(
  id: string,
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "progress" | "milestone_id" | "assigned_agent_id" | "due_date" | "start_date" | "estimate" | "recurrence_rule">>
): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateTask failed: ${res.status}`);
  return res.json();
}

async function completeTask(id: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    headers: JSON_HEADERS,
  });
  if (!res.ok) throw new Error(`completeTask failed: ${res.status}`);
  return res.json();
}

async function getAgents(): Promise<Agent[]> {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error(`getAgents failed: ${res.status}`);
  return res.json();
}

async function getActivity(limit = 50): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`getActivity failed: ${res.status}`);
  return res.json();
}

async function getBlockers(): Promise<Blocker[]> {
  const res = await fetch("/api/blockers");
  if (!res.ok) throw new Error(`getBlockers failed: ${res.status}`);
  return res.json();
}

async function getMilestones(projectId?: string): Promise<Milestone[]> {
  const url = projectId
    ? `/api/milestones?project_id=${encodeURIComponent(projectId)}`
    : "/api/milestones";
  const res = await fetch(url);
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
  const res = await fetch("/api/milestones", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createMilestone failed: ${res.status}`);
  return res.json();
}

async function updateMilestone(
  id: string,
  data: Partial<Pick<Milestone, "name" | "description" | "acceptance_criteria" | "status" | "target_date">>
): Promise<Milestone> {
  const res = await fetch(`/api/milestones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateMilestone failed: ${res.status}`);
  return res.json();
}

async function getTags(projectId: string): Promise<Tag[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tags`);
  if (!res.ok) throw new Error(`getTags failed: ${res.status}`);
  return res.json();
}

async function createTag(projectId: string, data: { name: string; color?: string }): Promise<Tag> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tags`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createTag failed: ${res.status}`);
  return res.json();
}

async function getTaskTags(taskId: string): Promise<Tag[]> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`);
  if (!res.ok) throw new Error(`getTaskTags failed: ${res.status}`);
  return res.json();
}

async function addTagToTask(taskId: string, tagId: string): Promise<TaskTag> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ tag_id: tagId }),
  });
  if (!res.ok) throw new Error(`addTagToTask failed: ${res.status}`);
  return res.json();
}

async function removeTagFromTask(taskId: string, tagId: string): Promise<void> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/tags/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`removeTagFromTask failed: ${res.status}`);
}

// ─── R2: Milestone Progress ─────────────────────────────────────────────

async function getMilestoneProgress(milestoneId: string): Promise<MilestoneProgress> {
  const res = await fetch(`/api/milestones/${encodeURIComponent(milestoneId)}/progress`);
  if (!res.ok) throw new Error(`getMilestoneProgress failed: ${res.status}`);
  return res.json();
}

// ─── R2: Dependencies ────────────────────────────────────────────────────

async function getDependencies(taskId: string): Promise<TaskDependency[]> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`);
  if (!res.ok) throw new Error(`getDependencies failed: ${res.status}`);
  return res.json();
}

async function getBlockingTasks(taskId: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/blocking`);
  if (!res.ok) throw new Error(`getBlockingTasks failed: ${res.status}`);
  return res.json();
}

async function addDependency(taskId: string, dependsOnTaskId: string): Promise<TaskDependency> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
  });
  if (!res.ok) throw new Error(`addDependency failed: ${res.status}`);
  return res.json();
}

async function removeDependency(depId: string): Promise<void> {
  await fetch(`/api/dependencies/${encodeURIComponent(depId)}`, { method: "DELETE" });
}

// ─── R2: Agent Detail ────────────────────────────────────────────────────

async function getAgentDetail(agentId: string): Promise<Agent & { health_status: string; completed_today: number; current_task_title: string | null }> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`);
  if (!res.ok) throw new Error(`getAgentDetail failed: ${res.status}`);
  return res.json();
}

async function getAgentActivity(agentId: string, limit = 50): Promise<ActivityEntry[]> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/activity?limit=${limit}`);
  if (!res.ok) throw new Error(`getAgentActivity failed: ${res.status}`);
  return res.json();
}

async function getAgentSessions(agentId: string): Promise<AgentSession[]> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/sessions`);
  if (!res.ok) throw new Error(`getAgentSessions failed: ${res.status}`);
  return res.json();
}

// ─── R2: Search ──────────────────────────────────────────────────────────

async function searchTasks(params: Record<string, string | undefined>): Promise<Task[]> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/tasks/search?${qs}`);
  if (!res.ok) throw new Error(`searchTasks failed: ${res.status}`);
  return res.json();
}

async function getSavedFilters(): Promise<SavedFilter[]> {
  const res = await fetch("/api/filters");
  if (!res.ok) throw new Error(`getSavedFilters failed: ${res.status}`);
  return res.json();
}

async function createSavedFilter(name: string, filterJson: string): Promise<SavedFilter> {
  const res = await fetch("/api/filters", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name, filter_json: filterJson }),
  });
  if (!res.ok) throw new Error(`createSavedFilter failed: ${res.status}`);
  return res.json();
}

async function deleteSavedFilter(id: string): Promise<void> {
  await fetch(`/api/filters/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── R3: Comments ────────────────────────────────────────────────────

async function getComments(taskId: string): Promise<TaskComment[]> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`);
  if (!res.ok) throw new Error(`getComments failed: ${res.status}`);
  return res.json();
}

async function addCommentApi(taskId: string, message: string, authorName: string): Promise<TaskComment> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/comments`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ message, author_name: authorName }),
  });
  if (!res.ok) throw new Error(`addComment failed: ${res.status}`);
  return res.json();
}

// ─── R3: File Locks ──────────────────────────────────────────────────

async function getFileConflicts(): Promise<FileConflict[]> {
  const res = await fetch("/api/file-locks/conflicts");
  if (!res.ok) throw new Error(`getFileConflicts failed: ${res.status}`);
  return res.json();
}

// ─── R3: Notifications ──────────────────────────────────────────────

async function getNotifications(limit = 50): Promise<AppNotification[]> {
  const res = await fetch(`/api/notifications?limit=${limit}`);
  if (!res.ok) throw new Error(`getNotifications failed: ${res.status}`);
  return res.json();
}

async function getUnreadCount(): Promise<number> {
  const res = await fetch("/api/notifications/unread-count");
  if (!res.ok) throw new Error(`getUnreadCount failed: ${res.status}`);
  const data = await res.json();
  return data.count;
}

async function markNotificationReadApi(id: string): Promise<void> {
  await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
}

async function markAllRead(): Promise<void> {
  await fetch("/api/notifications/mark-all-read", { method: "POST" });
}

// ─── R3: Alert Rules ────────────────────────────────────────────────

async function getAlertRules(): Promise<AlertRule[]> {
  const res = await fetch("/api/alert-rules");
  if (!res.ok) throw new Error(`getAlertRules failed: ${res.status}`);
  return res.json();
}

async function createAlertRule(eventType: string, filterJson?: string): Promise<AlertRule> {
  const res = await fetch("/api/alert-rules", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ event_type: eventType, filter_json: filterJson }),
  });
  if (!res.ok) throw new Error(`createAlertRule failed: ${res.status}`);
  return res.json();
}

// ─── R3: Bulk Update ────────────────────────────────────────────────

async function bulkUpdateTasks(taskIds: string[], updates: Record<string, unknown>): Promise<{ updated: number; tasks: Task[] }> {
  const res = await fetch("/api/tasks/bulk", {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify({ task_ids: taskIds, updates }),
  });
  if (!res.ok) throw new Error(`bulkUpdateTasks failed: ${res.status}`);
  return res.json();
}

// ─── R4: Agent Stats ─────────────────────────────────────────────────

async function getAgentStats(agentId: string, milestoneId?: string): Promise<AgentStats> {
  const qs = milestoneId ? `?milestone_id=${encodeURIComponent(milestoneId)}` : "";
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/stats${qs}`);
  if (!res.ok) throw new Error(`getAgentStats failed: ${res.status}`);
  return res.json();
}

async function getMilestoneContributions(milestoneId: string): Promise<AgentContribution[]> {
  const res = await fetch(`/api/milestones/${encodeURIComponent(milestoneId)}/contributions`);
  if (!res.ok) throw new Error(`getMilestoneContributions failed: ${res.status}`);
  return res.json();
}

// ─── R4: Milestone Daily Stats ───────────────────────────────────────────

async function getMilestoneDailyStats(milestoneId: string): Promise<MilestoneDailyStats[]> {
  const res = await fetch(`/api/milestones/${encodeURIComponent(milestoneId)}/daily-stats`);
  if (!res.ok) throw new Error(`getMilestoneDailyStats failed: ${res.status}`);
  return res.json();
}

// ─── R4: Heatmap & Reports ──────────────────────────────────────────

async function getActivityHeatmap(projectId?: string): Promise<ActivityHeatmapEntry[]> {
  const url = projectId ? `/api/activity-heatmap?project_id=${encodeURIComponent(projectId)}` : "/api/activity-heatmap";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getActivityHeatmap failed: ${res.status}`);
  return res.json();
}

async function generateReportApi(projectId: string, period: "day" | "week" | "milestone"): Promise<string> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/report`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ period }),
  });
  if (!res.ok) throw new Error(`generateReport failed: ${res.status}`);
  const data = await res.json();
  return data.report;
}

// ─── R5: Templates ───────────────────────────────────────────────────

async function getTemplates(): Promise<ProjectTemplate[]> {
  const res = await fetch("/api/templates");
  if (!res.ok) throw new Error(`getTemplates failed: ${res.status}`);
  return res.json();
}

async function instantiateTemplate(templateId: string, projectName: string): Promise<Project> {
  const res = await fetch(`/api/templates/${encodeURIComponent(templateId)}/instantiate`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ project_name: projectName }),
  });
  if (!res.ok) throw new Error(`instantiateTemplate failed: ${res.status}`);
  return res.json();
}

// ─── R5: Activity Stream ─────────────────────────────────────────────

async function getActivityStreamApi(params: Record<string, string | undefined> = {}): Promise<ActivityEntry[]> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/activity-stream${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getActivityStream failed: ${res.status}`);
  return res.json();
}

// ─── R6: Webhooks ────────────────────────────────────────────────────

async function getWebhooks(): Promise<Webhook[]> {
  const res = await fetch("/api/webhooks");
  if (!res.ok) throw new Error(`getWebhooks failed: ${res.status}`);
  return res.json();
}

async function createWebhookApi(url: string, eventTypes: string[]): Promise<Webhook> {
  const res = await fetch("/api/webhooks", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ url, event_types: eventTypes }),
  });
  if (!res.ok) throw new Error(`createWebhook failed: ${res.status}`);
  return res.json();
}

async function updateWebhookApi(id: string, updates: { url?: string; event_types?: string[]; active?: boolean }): Promise<Webhook> {
  const res = await fetch(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`updateWebhook failed: ${res.status}`);
  return res.json();
}

async function deleteWebhookApi(id: string): Promise<void> {
  await fetch(`/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Cost & Token Tracking ──────────────────────────────────────────

interface CostSummary {
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  entry_count: number;
}

interface CostTimeseriesEntry {
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
  const res = await fetch(`/api/costs/timeseries${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostTimeseries failed: ${res.status}`);
  return res.json();
}

async function getProjectCostSummary(projectId: string): Promise<CostSummary> {
  const res = await fetch(`/api/costs/project/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(`getProjectCostSummary failed: ${res.status}`);
  return res.json();
}

async function getCostByModel(params: Record<string, string | undefined> = {}): Promise<CostByModelEntry[]> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/costs/by-model${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostByModel failed: ${res.status}`);
  return res.json();
}

async function getCostByAgent(params: Record<string, string | undefined> = {}): Promise<CostByAgentEntry[]> {
  const qs = buildQueryString(params);
  const res = await fetch(`/api/costs/by-agent${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`getCostByAgent failed: ${res.status}`);
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
    getSavedFilters,
    createSavedFilter,
    deleteSavedFilter,
    getComments,
    addComment: addCommentApi,
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
    getCostByModel,
    getCostByAgent,
  }), []);
}
