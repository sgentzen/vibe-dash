import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
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

const PEPPER = process.env.VIBE_DASH_KEY_PEPPER ?? "";
if (!PEPPER) {
  // Without a pepper, HMAC degrades to unkeyed SHA-256. Set VIBE_DASH_KEY_PEPPER in production.
  console.warn("[auth] VIBE_DASH_KEY_PEPPER is not set — API key hashes have no pepper.");
}

// Cache the "auth is enabled" state — once true it never reverts
let _authEnabled: boolean | null = null;
export function isAuthEnabled(db: Database.Database): boolean {
  if (_authEnabled === true) return true;
  _authEnabled = countUsers(db) > 0;
  return _authEnabled;
}
/** Reset auth cache — test use only */
export function _resetAuthCache(): void {
  _authEnabled = null;
}

export function generateApiKey(): string {
  return randomBytes(32).toString("hex");
}

export function hashApiKey(key: string): string {
  // HMAC-SHA-256 keyed by pepper; "v1:" prefix enables future algorithm rotation.
  // CodeQL js/insufficient-password-hash: generateApiKey() returns 256-bit randomBytes,
  // so HMAC-SHA-256 is appropriate — scrypt/argon2 is for low-entropy passwords only.
  const hash = createHmac("sha256", PEPPER).update(key).digest("hex");
  return `v1:${hash}`;
}

export function verifyApiKey(key: string, stored: string): boolean {
  if (stored.startsWith("v1:")) {
    const expected = hashApiKey(key);
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(stored));
    } catch {
      return false;
    }
  }
  // Legacy: plain SHA-256 (transition window for existing installations)
  const legacy = createHash("sha256").update(key).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(legacy), Buffer.from(stored));
  } catch {
    return false;
  }
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
    // Try HMAC hash first; fall back to legacy SHA-256 so existing installations
    // aren't locked out before they rotate their keys.
    const hmacHash = hashApiKey(key);
    let user = getUserByKeyHash(db, hmacHash);
    if (!user) {
      const legacyHash = createHash("sha256").update(key).digest("hex");
      user = getUserByKeyHash(db, legacyHash);
    }

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

/**
 * Like requireRole but is a no-op when auth is disabled (no users registered).
 * Use for endpoints that should be open in local-only mode.
 */
export function requireRoleWhenEnabled(db: Database.Database, ...roles: UserRole[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!isAuthEnabled(db)) { next(); return; }
    requireRole(...roles)(req, res, next);
  };
}
