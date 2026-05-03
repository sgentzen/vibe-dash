import type Database from "better-sqlite3";
import type { Webhook } from "../types.js";
import { now, genId } from "./helpers.js";

function parseWebhookRow(row: Record<string, unknown>): Webhook {
  return {
    id: row.id as string,
    url: row.url as string,
    event_types: JSON.parse((row.event_types as string) ?? "[]"),
    active: Boolean(row.active),
    created_at: row.created_at as string,
  };
}

export function createWebhook(db: Database.Database, url: string, eventTypes: string[]): Webhook {
  const id = genId();
  const ts = now();
  const row = db.prepare("INSERT INTO webhooks (id, url, event_types, active, created_at) VALUES (?, ?, ?, 1, ?) RETURNING *").get(id, url, JSON.stringify(eventTypes), ts) as Record<string, unknown>;
  return parseWebhookRow(row);
}

export function listWebhooks(db: Database.Database): Webhook[] {
  const rows = db.prepare("SELECT * FROM webhooks ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(parseWebhookRow);
}

export function updateWebhook(db: Database.Database, id: string, updates: { url?: string; event_types?: string[]; active?: boolean }): Webhook | null {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.url !== undefined) { sets.push("url = ?"); params.push(updates.url); }
  if (updates.event_types !== undefined) { sets.push("event_types = ?"); params.push(JSON.stringify(updates.event_types)); }
  if (updates.active !== undefined) { sets.push("active = ?"); params.push(updates.active ? 1 : 0); }
  if (sets.length === 0) return null;
  params.push(id);
  const row = db.prepare("UPDATE webhooks SET " + sets.join(", ") + " WHERE id = ? RETURNING *").get(...params) as Record<string, unknown> | undefined;
  return row ? parseWebhookRow(row) : null;
}

export function deleteWebhook(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM webhooks WHERE id = ?").run(id).changes > 0;
}

export function getMatchingWebhooks(db: Database.Database, eventType: string): Webhook[] {
  const all = listWebhooks(db);
  return all.filter(w => w.active && w.event_types.includes(eventType));
}

export async function fireWebhooks(db: Database.Database, eventType: string, payload: unknown): Promise<void> {
  const hooks = getMatchingWebhooks(db, eventType);
  if (hooks.length === 0) return;
  const body = JSON.stringify({ event_type: eventType, payload, timestamp: now() });
  await Promise.allSettled(
    hooks.map((hook) =>
      fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      }).catch(() => {})
    )
  );
}
