import { Router } from "express";
import type Database from "better-sqlite3";
import {
  listNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  listMentions,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";

export function notificationRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/notifications", (req, res) => {
    const limit = parseInt((req.query.limit as string) ?? "50", 10);
    res.json(listNotifications(db, isNaN(limit) ? 50 : limit));
  });

  router.get("/api/notifications/unread-count", (_req, res) => {
    res.json({ count: getUnreadNotificationCount(db) });
  });

  router.patch("/api/notifications/:id/read", (req, res) => {
    res.json({ success: markNotificationRead(db, req.params.id) });
  });

  router.post("/api/notifications/mark-all-read", (_req, res) => {
    res.json({ marked: markAllNotificationsRead(db) });
  });

  router.get("/api/mentions/:agent_name", (req, res) => {
    res.json(listMentions(db, req.params.agent_name));
  });

  return router;
}
