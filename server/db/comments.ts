import type Database from "better-sqlite3";
import type { TaskComment } from "../types.js";
import { now, genId } from "./helpers.js";

export function addComment(
  db: Database.Database,
  taskId: string,
  message: string,
  authorName: string,
  agentId?: string | null
): TaskComment {
  const id = genId();
  const ts = now();
  return db.prepare(
    "INSERT INTO task_comments (id, task_id, agent_id, author_name, message, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
  ).get(id, taskId, agentId ?? null, authorName, message, ts) as TaskComment;
}

export function listComments(db: Database.Database, taskId: string): TaskComment[] {
  return db
    .prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId) as TaskComment[];
}

// ─── @Mentions ──────────────────────────────────────────────────────────────

const MENTION_REGEX = /@([\w-]+)/g;

export function extractMentions(message: string): string[] {
  const matches = message.matchAll(MENTION_REGEX);
  return [...new Set([...matches].map(m => m[1]))];
}

export function listMentions(db: Database.Database, agentName: string): TaskComment[] {
  const needle = `@${agentName}`;
  return db
    .prepare("SELECT * FROM task_comments WHERE INSTR(message, ?) > 0 ORDER BY created_at DESC")
    .all(needle) as TaskComment[];
}
