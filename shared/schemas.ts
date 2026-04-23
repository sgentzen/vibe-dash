// Shared Zod validation schemas used by both MCP tool registration
// and REST API validation middleware. Single source of truth for
// mutation input shapes.
import { z } from "zod";

// ─── Enums ──────────────────────────────────────────────────────────────

export const taskStatusEnum = z.enum(["planned", "in_progress", "blocked", "done"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export const milestoneStatusEnum = z.enum(["open", "achieved"]);
export const agentRoleEnum = z.enum([
  "orchestrator",
  "coder",
  "reviewer",
  "explorer",
  "planner",
  "agent",
]);

// ─── Helpers ────────────────────────────────────────────────────────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be a hex color like #ff0000");

// ─── Agents ─────────────────────────────────────────────────────────────

export const registerAgentSchema = z.object({
  name: z.string().min(1),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  role: agentRoleEnum.optional(),
  parent_agent_name: z.string().optional(),
});

// ─── Projects ───────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
});

// ─── Tasks ──────────────────────────────────────────────────────────────

export const createTaskSchema = z.object({
  project_id: z.string().min(1),
  parent_task_id: z.string().nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  assigned_agent_id: z.string().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPrioritySchema,
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  estimate: z.number().int().min(0).nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  agent_name: z.string().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: taskStatusEnum.optional(),
  priority: taskPrioritySchema.optional(),
  progress: z.number().min(0).max(100).optional(),
  parent_task_id: z.string().nullable().optional(),
  milestone_id: z.string().nullable().optional(),
  assigned_agent_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  estimate: z.number().int().min(0).nullable().optional(),
  recurrence_rule: z.string().nullable().optional(),
  agent_name: z.string().optional(),
});

// ─── Milestones ─────────────────────────────────────────────────────────

export const createMilestoneSchema = z.object({
  project_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  acceptance_criteria: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  status: milestoneStatusEnum.optional(),
});

export const updateMilestoneSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  acceptance_criteria: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  status: milestoneStatusEnum.optional(),
});

// ─── Tags ───────────────────────────────────────────────────────────────

export const createTagSchema = z.object({
  name: z.string().min(1),
  color: hexColor.optional(),
});

export const addTagToTaskSchema = z.object({
  tag_id: z.string().min(1),
});

// ─── Comments ───────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  agent_id: z.string().nullable().optional(),
  author_name: z.string().min(1),
  message: z.string().min(1),
});

// ─── Bulk operations ────────────────────────────────────────────────────

export const bulkUpdateTasksSchema = z.object({
  task_ids: z.array(z.string().min(1)).nonempty().max(200),
  updates: updateTaskSchema,
});

// ─── Routing ────────────────────────────────────────────────────────────

export const suggestAgentSchema = z.object({
  task_id: z.string().min(1),
});

// ─── Costs ──────────────────────────────────────────────────────────────

export const logCostSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cost_usd: z.number().finite().nonnegative(),
  agent_id: z.string().optional(),
  task_id: z.string().optional(),
  milestone_id: z.string().optional(),
  project_id: z.string().optional(),
});

// ─── Webhooks ───────────────────────────────────────────────────────────

export const createWebhookSchema = z.object({
  url: z.string().url().refine((u) => /^https?:/.test(u), "Only http/https URLs allowed"),
  event_types: z.array(z.string().min(1)).nonempty(),
});

export const updateWebhookSchema = z.object({
  url: z.string().url().refine((u) => /^https?:/.test(u), "Only http/https URLs allowed").optional(),
  event_types: z.array(z.string().min(1)).optional(),
  active: z.boolean().optional(),
});

// ─── File locks ──────────────────────────────────────────────────────────

export const reportWorkingOnSchema = z.object({
  task_id: z.string().min(1),
  file_paths: z.array(z.string().min(1)).nonempty(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const validJson = z.string().refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "must be valid JSON");

// ─── Templates ──────────────────────────────────────────────────────────

export const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  template_json: validJson,
});

export const instantiateTemplateSchema = z.object({
  project_name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const generateReportSchema = z.object({
  period: z.enum(["day", "week", "milestone"]).optional(),
});

// ─── Alert rules ────────────────────────────────────────────────────────

export const createAlertRuleSchema = z.object({
  event_type: z.string().min(1),
  filter_json: validJson.optional(),
});

export const updateAlertRuleSchema = z.object({
  enabled: z.boolean(),
});

// ─── Saved filters ───────────────────────────────────────────────────────

export const createSavedFilterSchema = z.object({
  name: z.string().min(1),
  filter_json: validJson,
});

// ─── Blockers ───────────────────────────────────────────────────────────

export const createBlockerSchema = z.object({
  task_id: z.string().min(1),
  reason: z.string().min(1),
});

// ─── Dependencies ────────────────────────────────────────────────────────

export const createDependencySchema = z.object({
  depends_on_task_id: z.string().min(1),
});

// ─── Worktrees ──────────────────────────────────────────────────────────

export const worktreeStatusEnum = z.enum(["active", "merged", "abandoned", "removed"]);

export const safeGitBranchName = z.string().min(1).regex(
  /^[a-zA-Z0-9._/-]+$/,
  "branch name must contain only alphanumeric characters, dots, dashes, underscores, and slashes"
).refine((s) => !s.startsWith("-"), "branch name must not start with a dash");

export const createWorktreeSchema = z.object({
  task_id: z.string().min(1),
  repo_path: z.string().min(1),
  branch_name: safeGitBranchName,
  worktree_path: z.string().min(1),
});

export const updateWorktreeStatusSchema = z.object({
  status: worktreeStatusEnum,
});

// ─── Reviews ────────────────────────────────────────────────────────────

export const reviewStatusEnum = z.enum(["pending", "approved", "changes_requested"]);

export const createReviewSchema = z.object({
  task_id: z.string().min(1),
  reviewer_name: z.string().optional(),
  reviewer_agent_id: z.string().optional(),
  status: reviewStatusEnum.optional(),
  comments: z.string().optional(),
  diff_summary: z.string().optional(),
});

export const updateReviewSchema = z.object({
  status: reviewStatusEnum.optional(),
  comments: z.string().nullable().optional(),
  diff_summary: z.string().nullable().optional(),
});
