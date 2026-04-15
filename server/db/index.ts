// Barrel re-export — all consumers import from "./db.js" or "../server/db.js"
// and get the same public API as the original monolithic db.ts.

export { initDb, openDb } from "./schema.js";
export { createProject, listProjects } from "./projects.js";
export {
  createSprint,
  updateSprint,
  getSprint,
  listSprints,
  getSprintCapacity,
  recordDailyStats,
  getSprintDailyStats,
  getVelocityTrend,
  getTimeSpent,
} from "./sprints.js";
export type { CreateSprintInput, UpdateSprintInput } from "./sprints.js";
export {
  createTask,
  getTask,
  listTasks,
  updateTask,
  completeTask,
  searchTasks,
  bulkUpdateTasks,
  handleRecurringTaskCompletion,
} from "./tasks.js";
export type { CreateTaskInput, ListTasksFilter, UpdateTaskInput, SearchTasksFilter } from "./tasks.js";
export {
  registerAgent,
  listAgents,
  getAgentByName,
  getAgentById,
  touchAgent,
  getAgentHealthStatus,
  getAgentActivity,
  getAgentCompletedToday,
  getAgentCurrentProject,
  getAllAgentCurrentProjects,
  getAgentStats,
  getSprintAgentContributions,
  startOrGetSession,
  closeAgentSessions,
  closeStaleSession,
  cleanupStaleAgents,
  listAgentSessions,
  reportWorkingOn,
  releaseFileLocks,
  getActiveFileLocks,
  getFileConflicts,
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
export { createBlocker, resolveBlocker, getActiveBlockers } from "./blockers.js";
export type { CreateBlockerInput } from "./blockers.js";
export { createTag, listTags, addTagToTask, removeTagFromTask, getTaskTags, getTag } from "./tags.js";
export type { CreateTagInput } from "./tags.js";
export { addDependency, removeDependency, listDependencies, getBlockingTasks } from "./dependencies.js";
export { createSavedFilter, listSavedFilters, deleteSavedFilter } from "./filters.js";
export { addComment, listComments, extractMentions, listMentions } from "./comments.js";
export {
  createAlertRule,
  listAlertRules,
  toggleAlertRule,
  deleteAlertRule,
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadNotificationCount,
  evaluateAlertRules,
} from "./notifications.js";
export {
  createTemplate,
  listTemplates,
  getTemplate,
  deleteTemplate,
  createProjectFromTemplate,
  seedBuiltInTemplates,
} from "./templates.js";
export {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  getMatchingWebhooks,
  fireWebhooks,
} from "./webhooks.js";
export {
  createMilestone,
  getMilestone,
  updateMilestone,
  completeMilestone,
  listMilestones,
} from "./milestones.js";
export type { CreateMilestoneInput, UpdateMilestoneInput } from "./milestones.js";
export { generateReport } from "./reports.js";
export {
  logCost,
  getAgentCostSummary,
  getSprintCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
} from "./costs.js";
export type { CostEntry, LogCostInput, CostSummary, CostTimeseriesEntry } from "./costs.js";
