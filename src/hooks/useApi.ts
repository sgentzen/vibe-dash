import { useMemo } from "react";
import type { Project, Task, Sprint, Agent, ActivityEntry, Blocker, Tag, TaskTag, TaskDependency, AgentSession, SavedFilter, SprintCapacity } from "../types";

const JSON_HEADERS = { "Content-Type": "application/json" };

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
  data: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "progress" | "sprint_id" | "assigned_agent_id" | "due_date" | "estimate">>
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

async function getSprints(projectId?: string): Promise<Sprint[]> {
  const url = projectId
    ? `/api/sprints?project_id=${encodeURIComponent(projectId)}`
    : "/api/sprints";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getSprints failed: ${res.status}`);
  return res.json();
}

async function createSprint(data: {
  project_id: string;
  name: string;
  description?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
}): Promise<Sprint> {
  const res = await fetch("/api/sprints", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`createSprint failed: ${res.status}`);
  return res.json();
}

async function updateSprint(
  id: string,
  data: Partial<Pick<Sprint, "name" | "description" | "status" | "start_date" | "end_date">>
): Promise<Sprint> {
  const res = await fetch(`/api/sprints/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: JSON_HEADERS,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`updateSprint failed: ${res.status}`);
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

// ─── R2: Sprint Capacity ─────────────────────────────────────────────────

async function getSprintCapacity(sprintId: string): Promise<SprintCapacity> {
  const res = await fetch(`/api/sprints/${encodeURIComponent(sprintId)}/capacity`);
  if (!res.ok) throw new Error(`getSprintCapacity failed: ${res.status}`);
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
  const qs = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
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
    getSprints,
    createSprint,
    updateSprint,
    getTags,
    createTag,
    getTaskTags,
    addTagToTask,
    removeTagFromTask,
    getSprintCapacity,
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
  }), []);
}
