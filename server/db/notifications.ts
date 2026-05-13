import type Database from "better-sqlite3";
import type { AppNotification } from "../types.js";
import { now, genId } from "./helpers.js";

export function createNotification(db: Database.Database, message: string): AppNotification {
  const id = genId();
  const ts = now();
  return db.prepare(
    "INSERT INTO notifications (id, rule_id, message, read, created_at) VALUES (?, NULL, ?, 0, ?) RETURNING *"
  ).get(id, message, ts) as AppNotification;
}

export function listNotifications(db: Database.Database, limit = 50): AppNotification[] {
  return db
    .prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AppNotification[];
}

export function markNotificationRead(db: Database.Database, id: string): boolean {
  return db.prepare("UPDATE notifications SET read = 1 WHERE id = ?").run(id).changes > 0;
}

export function markAllNotificationsRead(db: Database.Database): number {
  return db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run().changes;
}

export function getUnreadNotificationCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE read = 0").get() as { count: number };
  return row.count;
}

