import type { Response } from "express";
import { notFound } from "./responses.js";

/**
 * Narrowing guard for the "get-or-404" pattern.
 *
 * Usage:
 *   const task = getTask(db, req.params.id);
 *   if (!requireEntity(res, task, "Task")) return;
 *   // task is narrowed to non-null here
 *
 * Responds with 404 `{ error: "<label> not found" }` and returns false when
 * the entity is null/undefined. Returns true (and narrows the type) otherwise.
 */
export function requireEntity<T>(
  res: Response,
  entity: T | null | undefined,
  label: string
): entity is T {
  if (entity === null || entity === undefined) {
    notFound(res, `${label} not found`);
    return false;
  }
  return true;
}
