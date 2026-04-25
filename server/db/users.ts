import type Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { now } from "./helpers.js";
import type { User, UserRole } from "../../shared/types.js";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  api_key_hash: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createUser(
  db: Database.Database,
  data: { name: string; email: string; role: UserRole; api_key_hash: string }
): User {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO users (id, name, email, role, api_key_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.name, data.email, data.role, data.api_key_hash, ts, ts);
  return rowToUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow);
}

export function getUserByKeyHash(db: Database.Database, hash: string): (User & { api_key_hash: string }) | undefined {
  const row = db.prepare("SELECT * FROM users WHERE api_key_hash = ?").get(hash) as UserRow | undefined;
  if (!row) return undefined;
  return { ...rowToUser(row), api_key_hash: row.api_key_hash };
}

export function listUsers(db: Database.Database): User[] {
  return (
    db.prepare("SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at ASC").all() as UserRow[]
  ).map(rowToUser);
}

export function updateUserRole(db: Database.Database, id: string, role: UserRole): User | undefined {
  const ts = now();
  db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(role, ts, id);
  const row = db.prepare("SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function deleteUser(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function rotateApiKey(db: Database.Database, id: string, newKeyHash: string): User | undefined {
  const ts = now();
  db.prepare("UPDATE users SET api_key_hash = ?, updated_at = ? WHERE id = ?").run(newKeyHash, ts, id);
  const row = db.prepare("SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : undefined;
}

export function countUsers(db: Database.Database): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}
