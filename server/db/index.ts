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
  getMilestoneAgentContributions,
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
export { createBlocker, resolveBlocker, resolveBlockersForTask, getActiveBlockers } from "./blockers.js";
export type { CreateBlockerInput } from "./blockers.js";
export { createTag, listTags, addTagToTask, removeTagFromTask, getTaskTags, getTag } from "./tags.js";
export type { CreateTagInput } from "./tags.js";
export { addDependency, removeDependency, listDependencies, getBlockingTasks } from "./dependencies.js";
export { getTaskTagsForProject, getDependenciesForProject } from "./bulk.js";
export type { TaskTagPair } from "./bulk.js";
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
export { generateReport } from "./reports.js";
export { createReview, getReview, listReviewsForTask, updateReview } from "./reviews.js";
export type { CreateReviewInput, UpdateReviewInput } from "./reviews.js";
export {
  logCost,
  getAgentCostSummary,
  getMilestoneCostSummary,
  getProjectCostSummary,
  getCostTimeseries,
  getCostByModel,
  getCostByAgent,
  getGlobalCostSummary,
} from "./costs.js";
export type { CostEntry, LogCostInput, CostSummary, CostTimeseriesEntry } from "./costs.js";
export {
  logCompletionMetrics,
  getAgentPerformance,
  getAgentComparison,
  getTaskTypeBreakdown,
} from "./metrics.js";
export type { CompletionMetrics, LogCompletionMetricsInput, AgentPerformance, AgentComparison, TaskTypeBreakdown } from "./metrics.js";
export { scoreAgents, suggestAgent } from "./routing.js";
export type { AgentScore, AgentSuggestion } from "./routing.js";
export { getExecutiveSummary } from "./analytics.js";
export type { ExecutiveSummary, MilestoneHealth, TeamUtilization, BlockersSummary, TaskVelocity, CostOverview } from "./analytics.js";
export {
  createWorktree,
  getWorktreeById,
  getTaskWorktree,
  listActiveWorktrees,
  listAllWorktrees,
  updateWorktreeStatus,
} from "./worktrees.js";
export type { CreateWorktreeInput } from "./worktrees.js";
export {
  createGitIntegration,
  listGitIntegrations,
  getGitIntegration,
  deleteGitIntegration,
  updateLastSynced,
  upsertLinkedItem,
  getLinkedItemByExternal,
  listLinkedItems,
  getLinkedItemByTaskId,
} from "./git-sync.js";
export type { GitIntegration, GitIntegrationSafe, GitLinkedItem } from "./git-sync.js";
export {
  createUser,
  getUserByKeyHash,
  listUsers,
  updateUserRole,
  deleteUser,
  rotateApiKey,
  countUsers,
} from "./users.js";
