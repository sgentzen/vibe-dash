import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, DbOwnershipError } from "../server/db/index.js";
import { acquireOwnerLock, getProcessIdentity } from "../server/db/ownerLock.js";
import { createTestDb } from "./setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOLD_LOCK_FIXTURE = path.join(__dirname, "fixtures", "hold-lock.ts");

/** Spawn a real, otherwise-idle process so its PID is genuinely live and
 * distinct from this test process's own — the PID-liveness check in
 * ownerLock.ts treats "the caller's own PID" as always alive/reentrant, which
 * a same-process fake PID can't exercise. */
function spawnIdleProcess(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    child.once("spawn", () => resolve(child));
    child.once("error", reject);
  });
}

/** Spawn tests/fixtures/hold-lock.ts, which calls openDb() and stays alive —
 * used to test the module-level SIGTERM/SIGINT handlers, which only do
 * anything when a real OS signal reaches the process that owns the lock. */
function spawnLockHolder(dbPath: string, entryPoint: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", HOLD_LOCK_FIXTURE, dbPath, entryPoint], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const onData = (chunk: Buffer): void => {
      if (chunk.toString().includes("READY")) {
        child.stdout.off("data", onData);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`hold-lock fixture exited early (${code}):\n${stderr}`));
    });
  });
}

function waitForExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function writeLockFile(lockPath: string, pid: number, entryPoint: string, identity?: string): void {
  fs.writeFileSync(
    lockPath,
    JSON.stringify({ pid, entryPoint, startedAt: new Date().toISOString(), identity }),
    "utf8"
  );
}

describe("advisory owner lock (ARCH-1)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-lock-test-"));
    dbPath = path.join(dbDir, "vibe-dash.db");
  });

  afterEach(() => {
    delete process.env.VIBE_DASH_ALLOW_SHARED_DB;
    fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("never applies to :memory: databases", () => {
    // createTestDb() goes through initDb(), not openDb() — this asserts the
    // lock primitive itself is a no-op for :memory:, so nothing that calls
    // openDb(":memory:", ...) directly would be affected either.
    const release = acquireOwnerLock(":memory:", "test");
    expect(fs.existsSync(":memory:.owner.lock")).toBe(false);
    release();

    // And the ordinary test fixture never leaves a lock file anywhere.
    const db = createTestDb();
    expect(db).toBeTruthy();
  });

  it("lets a single owner open read-write and releases on request", () => {
    const db = openDb(dbPath, "server");
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);
    const holder = JSON.parse(fs.readFileSync(`${dbPath}.owner.lock`, "utf8"));
    expect(holder.pid).toBe(process.pid);
    expect(holder.entryPoint).toBe("server");
    db.close();
  });

  it("refuses a second live owner, naming the process that holds it", async () => {
    const other = await spawnIdleProcess();
    try {
      writeLockFile(`${dbPath}.owner.lock`, other.pid!, "server");

      expect(() => openDb(dbPath, "stdio-mcp")).toThrow(DbOwnershipError);
      try {
        openDb(dbPath, "stdio-mcp");
        expect.unreachable("openDb should have thrown DbOwnershipError");
      } catch (err) {
        expect(err).toBeInstanceOf(DbOwnershipError);
        const dbErr = err as DbOwnershipError;
        expect(dbErr.holder.entryPoint).toBe("server");
        expect(dbErr.holder.pid).toBe(other.pid);
        expect(dbErr.message).toContain("server");
        expect(dbErr.message).toContain(String(other.pid));
      }
    } finally {
      other.kill();
    }
  });

  it("takes over a stale lock left by a dead PID", () => {
    // A PID that (almost certainly) does not exist on this machine.
    const deadPid = 999999;
    writeLockFile(`${dbPath}.owner.lock`, deadPid, "server");

    const db = openDb(dbPath, "stdio-mcp");
    const holder = JSON.parse(fs.readFileSync(`${dbPath}.owner.lock`, "utf8"));
    expect(holder.pid).toBe(process.pid);
    expect(holder.entryPoint).toBe("stdio-mcp");
    db.close();
  });

  it("takes over a corrupt or unreadable lock file", () => {
    // Truncated/garbage JSON — e.g. from a process killed mid-write on an
    // older build, or manual tampering. readHolder() can't parse this, and
    // unparseable is treated the same as stale rather than as "live, unknown
    // holder" (which would wedge every future opener forever).
    fs.writeFileSync(`${dbPath}.owner.lock`, "{not valid json", "utf8");

    const db = openDb(dbPath, "server");
    const holder = JSON.parse(fs.readFileSync(`${dbPath}.owner.lock`, "utf8"));
    expect(holder.pid).toBe(process.pid);
    db.close();
  });

  it("release() is idempotent and a no-op once another process owns the lock", () => {
    // Acquire and release normally first.
    const releaseA = acquireOwnerLock(dbPath, "server");
    releaseA();
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(false);
    // Calling it again must not throw, even with nothing to release.
    expect(() => releaseA()).not.toThrow();

    // A second, distinct owner now takes the lock.
    const releaseB = acquireOwnerLock(dbPath, "stdio-mcp");
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);

    // The first (already-released) owner's release function must still be a
    // no-op — it must never delete a lock file it no longer owns.
    releaseA();
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);
    const holder = JSON.parse(fs.readFileSync(`${dbPath}.owner.lock`, "utf8"));
    expect(holder.entryPoint).toBe("stdio-mcp");

    releaseB();
  });

  it("release() never deletes a lock file another process has since taken over", () => {
    const release = acquireOwnerLock(dbPath, "server");

    // Simulate this lock having gone stale and been reclaimed by someone
    // else in the meantime — a different PID now owns the file on disk.
    writeLockFile(`${dbPath}.owner.lock`, 999999, "stdio-mcp");

    release();

    // The new owner's lock must survive an old owner's release() call.
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);
    const holder = JSON.parse(fs.readFileSync(`${dbPath}.owner.lock`, "utf8"));
    expect(holder.pid).toBe(999999);
  });

  it("VIBE_DASH_ALLOW_SHARED_DB bypasses the lock entirely", async () => {
    const other = await spawnIdleProcess();
    try {
      writeLockFile(`${dbPath}.owner.lock`, other.pid!, "server");

      process.env.VIBE_DASH_ALLOW_SHARED_DB = "1";
      // A live, distinct-PID holder is in place, but the bypass must still
      // let a second open through untouched.
      let db: ReturnType<typeof openDb> | undefined;
      expect(() => {
        db = openDb(dbPath, "stdio-mcp");
      }).not.toThrow();
      db?.close();
    } finally {
      other.kill();
    }
  });

  // Windows can't deliver SIGTERM as a catchable signal at all (it terminates
  // the process unconditionally), and SIGINT only reaches a process sharing
  // the parent's console — neither matches the `docker stop` scenario this
  // covers (a Linux container's SIGTERM). Runs for real on Linux CI.
  describe.skipIf(process.platform === "win32")("releases the lock on SIGTERM/SIGINT (docker stop)", () => {
    it("removes the lock file when the holder receives SIGTERM", async () => {
      const holder = await spawnLockHolder(dbPath, "server");
      try {
        expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);
        holder.kill("SIGTERM");
        const { code, signal } = await waitForExit(holder);
        // Re-raising after releasing (rather than calling process.exit
        // ourselves) means the process is terminated BY the signal, which
        // Node reports as a null exit code plus the signal name — the same
        // shape `docker stop` or a plain unhandled SIGTERM would produce.
        expect(code).toBeNull();
        expect(signal).toBe("SIGTERM");
        expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(false);
      } finally {
        if (!holder.killed) holder.kill("SIGKILL");
      }
    });

    it("removes the lock file when the holder receives SIGINT", async () => {
      const holder = await spawnLockHolder(dbPath, "server");
      try {
        expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(true);
        holder.kill("SIGINT");
        const { code, signal } = await waitForExit(holder);
        expect(code).toBeNull();
        expect(signal).toBe("SIGINT");
        expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(false);
      } finally {
        if (!holder.killed) holder.kill("SIGKILL");
      }
    });
  });

  // /proc is Linux-only; Windows and macOS fall back to PID-liveness alone
  // (unchanged prior behaviour), so this whole scenario only applies there.
  describe.skipIf(!(process.platform === "linux" && fs.existsSync("/proc/self/stat")))(
    "PID reuse guard via /proc start-time identity (Linux only)",
    () => {
      it("treats a live PID as stale when its /proc start-time identity no longer matches the recorded one", async () => {
        const other = await spawnIdleProcess();
        try {
          const lockPath = `${dbPath}.owner.lock`;
          // other.pid is genuinely alive, but the recorded identity does not
          // match its actual /proc start time — simulating the process that
          // originally wrote the lock having exited, with this PID later
          // reassigned by the OS to an unrelated live process (the container
          // restart-loop scenario).
          writeLockFile(lockPath, other.pid!, "server", "deliberately-wrong-boot-id:0");

          const db = openDb(dbPath, "stdio-mcp");
          const holder = JSON.parse(fs.readFileSync(lockPath, "utf8"));
          expect(holder.pid).toBe(process.pid);
          db.close();
        } finally {
          other.kill();
        }
      });

      it("still refuses when the recorded identity matches the live holder", async () => {
        const other = await spawnIdleProcess();
        try {
          const identity = getProcessIdentity(other.pid!);
          expect(identity).toBeDefined();
          writeLockFile(`${dbPath}.owner.lock`, other.pid!, "server", identity);

          expect(() => openDb(dbPath, "stdio-mcp")).toThrow(DbOwnershipError);
        } finally {
          other.kill();
        }
      });
    }
  );
});
