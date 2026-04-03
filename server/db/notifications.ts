import type Database from "better-sqlite3";
import type { AlertRule, AppNotification } from "../types.js";
import { now, genId } from "./helpers.js";

export function createAlertRule(
  db: Database.Database,
  eventType: string,
  filterJson = "{}"
): AlertRule {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO alert_rules (id, event_type, filter_json, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
  ).run(id, eventType, filterJson, ts);
  return db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRule;
}

export function listAlertRules(db: Database.Database): AlertRule[] {
  return db.prepare("SELECT * FROM alert_rules ORDER BY created_at DESC").all() as AlertRule[];
}

export function toggleAlertRule(db: Database.Database, id: string, enabled: boolean): AlertRule | null {
  db.prepare("UPDATE alert_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  return db.prepare("SELECT * FROM alert_rules WHERE id = ?").get(id) as AlertRule | null;
}

export function deleteAlertRule(db: Database.Database, id: string): boolean {
  return db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id).changes > 0;
}

export function createNotification(db: Database.Database, message: string, ruleId?: string | null): AppNotification {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO notifications (id, rule_id, message, read, created_at) VALUES (?, ?, ?, 0, ?)"
  ).run(id, ruleId ?? null, message, ts);
  return db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as AppNotification;
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

export function evaluateAlertRules(db: Database.Database, eventType: string, eventPayload: Record<string, unknown>): AppNotification[] {
  const rules = db
    .prepare("SELECT * FROM alert_rules WHERE event_type = ? AND enabled = 1")
    .all(eventType) as AlertRule[];

  const notifications: AppNotification[] = [];
  for (const rule of rules) {
    let filterMatch = true;
    try {
      const filter = JSON.parse(rule.filter_json) as Record<string, unknown>;
      for (const [key, value] of Object.entries(filter)) {
        if (eventPayload[key] !== value) { filterMatch = false; break; }
      }
    } catch { filterMatch = true; }

    if (filterMatch) {
      const msg = `Alert: ${eventType} event triggered (rule ${rule.id})`;
      notifications.push(createNotification(db, msg, rule.id));
    }
  }
  return notifications;
}
