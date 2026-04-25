import { Router } from "express";
import type Database from "better-sqlite3";
import {
  addComment,
  listComments,
  extractMentions,
  createNotification,
  evaluateAlertRules,
} from "../db/index.js";
import type { BroadcastFn } from "./types.js";
import { badRequest } from "./responses.js";
import { createCommentSchema } from "../../shared/schemas.js";
import { validateBody } from "./validate.js";

export function commentRoutes(db: Database.Database, broadcast: BroadcastFn): Router {
  const router = Router();

  router.get("/api/tasks/:id/comments", (req, res) => {
    res.json(listComments(db, req.params.id));
  });

  router.post("/api/tasks/:id/comments", validateBody(createCommentSchema), (req, res) => {
    const { message, author_name, agent_id } = req.body as { message: string; author_name: string; agent_id?: string };
    const comment = addComment(db, req.params.id, message, author_name, agent_id);
    broadcast({ type: "comment_added", payload: comment });

    const mentions = extractMentions(message);
    for (const name of mentions) {
      const notif = createNotification(db, `${author_name} mentioned @${name} in a comment`);
      broadcast({ type: "notification_created", payload: notif });
    }

    const notifications = evaluateAlertRules(db, "comment_added", { task_id: req.params.id });
    for (const n of notifications) broadcast({ type: "notification_created", payload: n });

    res.status(201).json(comment);
  });

  return router;
}
