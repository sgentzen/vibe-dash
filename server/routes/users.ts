import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import { createUser, listUsers, updateUserRole, deleteUser, rotateApiKey, countUsers } from "../db/users.js";
import { generateApiKey, hashApiKey, requireRole } from "../auth.js";
import { validateBody } from "./validate.js";
import type { BroadcastFn } from "./types.js";
import type { UserRole } from "../../shared/types.js";

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "developer", "viewer"]).default("viewer"),
});

const updateRoleSchema = z.object({
  role: z.enum(["admin", "developer", "viewer"]),
});

export function userRoutes(db: Database.Database, _broadcast: BroadcastFn): Router {
  const router = Router();

  // GET /api/auth/status — public discovery endpoint (exempt from auth middleware)
  router.get("/api/auth/status", (req, res) => {
    res.json({ auth_enabled: countUsers(db) > 0 });
  });

  // GET /api/auth/me — current authenticated user
  router.get("/api/auth/me", (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(req.user);
  });

  // POST /api/users — create user (admin only, or first user = admin)
  router.post("/api/users", validateBody(createUserSchema), (req, res) => {
    const isFirstUser = countUsers(db) === 0;
    if (!isFirstUser) {
      // Not first user — must be admin
      if (!req.user || req.user.role !== "admin") {
        res.status(403).json({ error: "Admin role required" });
        return;
      }
    }

    const { name, email, role } = req.body as { name: string; email: string; role: UserRole };
    const effectiveRole: UserRole = isFirstUser ? "admin" : role;
    const apiKey = generateApiKey();
    const hash = hashApiKey(apiKey);

    try {
      const user = createUser(db, { name, email, role: effectiveRole, api_key_hash: hash });
      // Return the plain-text key only on creation — never stored, never retrievable again
      res.status(201).json({ user, api_key: apiKey });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.message?.includes("UNIQUE constraint failed: users.email")) {
        res.status(409).json({ error: "Email already in use" });
        return;
      }
      throw err;
    }
  });

  // GET /api/users — list users (admin only)
  router.get("/api/users", requireRole("admin"), (req, res) => {
    res.json(listUsers(db));
  });

  // PATCH /api/users/:id/role — update role (admin only)
  router.patch("/api/users/:id/role", requireRole("admin"), validateBody(updateRoleSchema), (req, res) => {
    const user = updateUserRole(db, req.params.id as string, req.body.role as UserRole);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(user);
  });

  // DELETE /api/users/:id — delete user (admin only)
  router.delete("/api/users/:id", requireRole("admin"), (req, res) => {
    if (req.user?.id === req.params.id as string) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    deleteUser(db, req.params.id as string);
    res.status(204).end();
  });

  // POST /api/users/:id/rotate-key — rotate API key (admin or self)
  router.post("/api/users/:id/rotate-key", (req, res) => {
    const isSelf = req.user?.id === req.params.id as string;
    const isAdmin = req.user?.role === "admin";
    if (!isSelf && !isAdmin) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    const newKey = generateApiKey();
    const newHash = hashApiKey(newKey);
    const user = rotateApiKey(db, req.params.id as string, newHash);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user, api_key: newKey });
  });

  return router;
}
