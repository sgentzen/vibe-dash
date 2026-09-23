import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "migrate-once.ts");

function runMigrateOnce(dbPath: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", FIXTURE, dbPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("busy_timeout (DATA-15)", () => {
  it("is set explicitly rather than relying on the driver default", () => {
    const db = createTestDb();
    const timeout = db.pragma("busy_timeout", { simple: true }) as number;
    expect(timeout).toBe(5000);
  });
});

describe("concurrent startup migration (DATA-15)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-concurrent-migrate-"));
    dbPath = path.join(dbDir, "vibe-dash.db");
  });

  afterEach(() => {
    fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("two processes starting together both succeed, with migrations applied exactly once", async () => {
    // Pre-warm the file to WAL mode, single-threaded, before racing. Switching
    // journal mode itself needs a brief exclusive lock that two brand-new
    // connections can also collide on — a real but separate race from the one
    // DATA-15 targets (two processes both trying to apply the same migration
    // row). Doing it here isolates the migration race this test exists to
    // cover; a fresh install still goes through the same one-time WAL
    // negotiation, just typically from a single first-run process.
    const warm = new Database(dbPath);
    warm.pragma("journal_mode = WAL");
    warm.close();

    const [a, b] = await Promise.all([runMigrateOnce(dbPath), runMigrateOnce(dbPath)]);

    // Neither process should crash on the _migrations UNIQUE constraint — the
    // exact failure mode DATA-15 describes for deferred transactions with no
    // explicit busy_timeout.
    expect(a.code, `process A stderr:\n${a.stderr}`).toBe(0);
    expect(b.code, `process B stderr:\n${b.stderr}`).toBe(0);
    expect(a.stdout).toContain("OK");
    expect(b.stdout).toContain("OK");

    const db = new Database(dbPath, { readonly: true });
    const names = (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name);
    // No duplicate rows — each migration name is recorded exactly once even
    // though two processes both attempted to apply it.
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(0);
    db.close();
  }, 30000);
});
