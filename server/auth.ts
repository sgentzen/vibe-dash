import { createHash, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { getUserByKeyHash, countUsers } from "./db/users.js";
import type { User, UserRole } from "../shared/types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// Cache the "auth is enabled" state — once true it never reverts
let _authEnabled: boolean | null = null;
export function isAuthEnabled(db: Database.Database): boolean {
  if (_authEnabled === true) return true;
  _authEnabled = countUsers(db) > 0;
  return _authEnabled;
}

export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function makeAuthMiddleware(db: Database.Database) {
  return function authMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!isAuthEnabled(db)) {
      // No users — auth is disabled (local-only mode)
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const key = authHeader.slice(7);
    const hash = hashApiKey(key);
    const user = getUserByKeyHash(db, hash);

    if (!user) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    req.user = user;
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
