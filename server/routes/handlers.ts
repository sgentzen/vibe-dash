import type { Response } from "express";
import type { WsEvent, WsEventType } from "../types.js";
import { notFound } from "./responses.js";
import type { BroadcastFn } from "./types.js";

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
export function handleMutation<T>(
  res: Response,
  broadcast: BroadcastFn,
  fn: () => T,
  eventType: WsEventType,
  status = 200
): void {
  let result: T;
  try {
    result = fn();
  } catch {
    res.status(500).json({ error: "Internal server error" });
    return;
  }
  // Cast required: TS cannot correlate WsEventType literals to payload shapes; call sites enforce the pairing.
  broadcast({ type: eventType, payload: result } as WsEvent);
  res.status(status).json(result);
}

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
