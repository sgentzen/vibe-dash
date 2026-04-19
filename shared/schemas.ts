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
  description: z.string().optional(),
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

// ─── Comments ───────────────────────────────────────────────────────────

export const createCommentSchema = z.object({
  agent_id: z.string().nullable().optional(),
  author_name: z.string().min(1),
  message: z.string().min(1),
});

// ─── Costs ──────────────────────────────────────────────────────────────

export const logCostSchema = z.object({
  model: z.string().min(1),
  provider: z.string().min(1),
  input_tokens: z.number().finite().nonnegative(),
  output_tokens: z.number().finite().nonnegative(),
  cost_usd: z.number().finite().nonnegative(),
  agent_id: z.string().optional(),
  task_id: z.string().optional(),
  milestone_id: z.string().optional(),
  project_id: z.string().optional(),
});
