import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./setup.js";
import type Database from "better-sqlite3";
import { createUser, getUserByKeyHash, listUsers, updateUserRole, deleteUser, rotateApiKey, countUsers } from "../server/db/users.js";
import { generateApiKey, hashApiKey, makeAuthMiddleware, requireRole, isAuthEnabled } from "../server/auth.js";
import type { Request, Response, NextFunction } from "express";

// Reset module-level cache between tests
function resetAuthCache() {
  // Access the module's internal cache by re-importing — not possible cleanly,
  // so we create fresh DBs with no users to test the zero-user path.
}

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── User DB helpers ───────────────────────────────────────────────────────────

describe("users DB", () => {
  it("countUsers returns 0 on fresh DB", () => {
    expect(countUsers(db)).toBe(0);
  });

  it("createUser persists user and returns without api_key_hash", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    const user = createUser(db, { name: "Alice", email: "alice@test.com", role: "admin", api_key_hash: hash });
    expect(user.id).toBeTruthy();
    expect(user.name).toBe("Alice");
    expect(user.role).toBe("admin");
    expect((user as unknown as Record<string, unknown>).api_key_hash).toBeUndefined();
    expect(countUsers(db)).toBe(1);
  });

  it("getUserByKeyHash returns user for correct key", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    createUser(db, { name: "Bob", email: "bob@test.com", role: "developer", api_key_hash: hash });
    const found = getUserByKeyHash(db, hash);
    expect(found?.name).toBe("Bob");
    expect(found?.api_key_hash).toBe(hash);
  });

  it("getUserByKeyHash returns undefined for wrong key", () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    createUser(db, { name: "Carol", email: "carol@test.com", role: "viewer", api_key_hash: hash });
    expect(getUserByKeyHash(db, hashApiKey("wrong-key"))).toBeUndefined();
  });

  it("listUsers excludes api_key_hash", () => {
    const key = generateApiKey();
    createUser(db, { name: "Dave", email: "dave@test.com", role: "viewer", api_key_hash: hashApiKey(key) });
    const users = listUsers(db);
    expect(users).toHaveLength(1);
    expect((users[0] as unknown as Record<string, unknown>).api_key_hash).toBeUndefined();
  });

  it("updateUserRole changes role", () => {
    const key = generateApiKey();
    const user = createUser(db, { name: "Eve", email: "eve@test.com", role: "viewer", api_key_hash: hashApiKey(key) });
    const updated = updateUserRole(db, user.id, "admin");
    expect(updated?.role).toBe("admin");
  });

  it("deleteUser removes user", () => {
    const key = generateApiKey();
    const user = createUser(db, { name: "Frank", email: "frank@test.com", role: "viewer", api_key_hash: hashApiKey(key) });
    deleteUser(db, user.id);
    expect(countUsers(db)).toBe(0);
  });

  it("rotateApiKey invalidates old key and accepts new one", () => {
    const oldKey = generateApiKey();
    const oldHash = hashApiKey(oldKey);
    const user = createUser(db, { name: "Grace", email: "grace@test.com", role: "developer", api_key_hash: oldHash });
    const newKey = generateApiKey();
    const newHash = hashApiKey(newKey);
    rotateApiKey(db, user.id, newHash);
    expect(getUserByKeyHash(db, oldHash)).toBeUndefined();
    expect(getUserByKeyHash(db, newHash)?.name).toBe("Grace");
  });
});

// ─── generateApiKey / hashApiKey ──────────────────────────────────────────────

describe("key utilities", () => {
  it("generateApiKey returns 64-char hex string", () => {
    const key = generateApiKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashApiKey is deterministic", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("different keys produce different hashes", () => {
    expect(hashApiKey(generateApiKey())).not.toBe(hashApiKey(generateApiKey()));
  });
});

// ─── makeAuthMiddleware ────────────────────────────────────────────────────────

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers, user: undefined } as unknown as Request;
}

function mockRes(): { status: (n: number) => { json: (o: unknown) => void }; statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(n: number) {
      res.statusCode = n;
      return { json(o: unknown) { res.body = o; } };
    },
  };
  return res;
}

describe("makeAuthMiddleware", () => {
  it("calls next() without auth when no users exist (local-only mode)", () => {
    const middleware = makeAuthMiddleware(db);
    const req = mockReq();
    const res = mockRes();
    let called = false;
    middleware(req, res as unknown as Response, (() => { called = true; }) as NextFunction);
    expect(called).toBe(true);
    expect(res.statusCode).toBe(0);
  });

  it("returns 401 when users exist and no Authorization header", () => {
    const key = generateApiKey();
    createUser(db, { name: "H", email: "h@test.com", role: "admin", api_key_hash: hashApiKey(key) });
    const middleware = makeAuthMiddleware(db);
    const req = mockReq();
    const res = mockRes();
    middleware(req, res as unknown as Response, (() => {}) as NextFunction);
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for wrong key", () => {
    const key = generateApiKey();
    createUser(db, { name: "I", email: "i@test.com", role: "admin", api_key_hash: hashApiKey(key) });
    const middleware = makeAuthMiddleware(db);
    const req = mockReq({ authorization: `Bearer ${generateApiKey()}` });
    const res = mockRes();
    middleware(req, res as unknown as Response, (() => {}) as NextFunction);
    expect(res.statusCode).toBe(401);
  });

  it("attaches user and calls next() for valid key", () => {
    const key = generateApiKey();
    createUser(db, { name: "J", email: "j@test.com", role: "developer", api_key_hash: hashApiKey(key) });
    const middleware = makeAuthMiddleware(db);
    const req = mockReq({ authorization: `Bearer ${key}` });
    const res = mockRes();
    let called = false;
    middleware(req, res as unknown as Response, (() => { called = true; }) as NextFunction);
    expect(called).toBe(true);
    expect((req as Request & { user?: { name: string } }).user?.name).toBe("J");
  });
});

// ─── requireRole ──────────────────────────────────────────────────────────────

describe("requireRole", () => {
  it("returns 401 when req.user is undefined", () => {
    const mw = requireRole("admin");
    const req = { user: undefined } as unknown as Request;
    const res = mockRes();
    mw(req, res as unknown as Response, (() => {}) as NextFunction);
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when role is insufficient", () => {
    const mw = requireRole("admin");
    const req = { user: { role: "viewer" } } as unknown as Request;
    const res = mockRes();
    mw(req, res as unknown as Response, (() => {}) as NextFunction);
    expect(res.statusCode).toBe(403);
  });

  it("calls next() when role matches", () => {
    const mw = requireRole("admin", "developer");
    const req = { user: { role: "developer" } } as unknown as Request;
    const res = mockRes();
    let called = false;
    mw(req, res as unknown as Response, (() => { called = true; }) as NextFunction);
    expect(called).toBe(true);
  });
});

// ─── Migration system ─────────────────────────────────────────────────────────

describe("migration system", () => {
  it("_migrations table is created and tracks runs", () => {
    const rows = db.prepare("SELECT name FROM _migrations ORDER BY id").all() as { name: string }[];
    const names = rows.map(r => r.name);
    expect(names).toContain("001_initial_schema");
    expect(names).toContain("005_users");
  });

  it("users table exists after migration", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").all();
    expect(tables).toHaveLength(1);
  });

  it("running migrations twice is idempotent", async () => {
    const { runMigrations } = await import("../server/db/migrator.js");
    const before = (db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number }).c;
    runMigrations(db);
    const after = (db.prepare("SELECT COUNT(*) AS c FROM _migrations").get() as { c: number }).c;
    expect(after).toBe(before);
  });
});
