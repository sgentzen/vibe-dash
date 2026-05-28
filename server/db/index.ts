// Barrel re-export — all consumers import from "./db.js" or "../server/db.js"
// and get the same public API as the original monolithic db.ts.

export { initDb, openDb } from "./schema.js";
export { normalizeAgentName } from "./helpers.js";
export { createProject, updateProject, listProjects } from "./projects.js";
export {
  createMilestone,
  updateMilestone,
  completeMilestone,
  getMilestone,
  listMilestones,
  deleteMilestone,
  getMilestoneProgress,
  recordMilestoneDailyStats,
  getMilestoneDailyStats,
  backfillMilestoneDailyStats,
  getTimeSpent,
} from "./milestones.js";
export type { CreateMilestoneInput, UpdateMilestoneInput } from "./milestones.js";
export {
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  getTasksCompletedToday,
  searchTasks,
  bulkUpdateTasks,
} from "./tasks.js";
export type { CreateTaskInput, ListTasksFilter, UpdateTaskInput, SearchTasksFilter } from "./tasks.js";
export {
  registerAgent,
  listAgents,
  getAgentByName,
  getAgentById,
  touchAgent,
  setAgentStatus,
  getAgentHealthStatus,
  getAgentActivity,
  getAgentCompletedToday,
  getAgentCurrentProject,
  getAllAgentCurrentProjects,
  getAgentStats,
  getMilestoneAgentContributions,
  startOrGetSession,
  closeAgentSessions,
  closeStaleSession,
  cleanupStaleAgents,
  listAgentSessions,
  ACTIVE_THRESHOLD_MS,
  IDLE_THRESHOLD_MS,
  ACTIVE_THRESHOLD_MINUTES,
} from "./agents.js";
export type { RegisterAgentInput } from "./agents.js";
export {
  logActivity,
  getRecentActivity,
  getAgentCurrentTask,
  getActivityStream,
  getAgentActivityHeatmap,
} from "./activity.js";
export type { LogActivityInput, ActivityStreamFilter } from "./activity.js";
export { createBlocker, resolveBlocker, resolveBlockersForTask, getActiveBlockers } from "./blockers.js";
export type { CreateBlockerInput } from "./blockers.js";
export { createTag, listTags, addTagToTask, removeTagFromTask, getTaskTags, getTag } from "./tags.js";
export type { CreateTagInput } from "./tags.js";
export { addDependency, removeDependency, listDependencies, getBlockingTasks } from "./dependencies.js";
export { getTaskTagsForProject, getDependenciesForProject } from "./bulk.js";
export type { TaskTagPair } from "./bulk.js";
export { addComment, listComments, extractMentions, listMentions } from "./comments.js";
export {
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
} from "./notifications.js";
export {
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
  getGlobalCostSummary,
  getSpendToday,
} from "./costs.js";
export type { CostEntry, LogCostInput, CostSummary, CostTimeseriesEntry } from "./costs.js";
export {
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "./metrics.js";
export type { CompletionMetrics, LogCompletionMetricsInput, AgentPerformance, AgentComparison, TaskTypeBreakdown } from "./metrics.js";
export {
  createWorktree,
  getWorktreeById,
  getTaskWorktree,
  listActiveWorktrees,
  listAllWorktrees,
  updateWorktreeStatus,
} from "./worktrees.js";
export type { CreateWorktreeInput } from "./worktrees.js";
