import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDb, openDb } from "../server/db/index.js";
import { runMigrations, MigrationSnapshotError } from "../server/db/migrator.js";
import {
  preMigrationFolder,
  resolveBackupDir,
  SnapshotError,
  takePreMigrationSnapshot,
  writeVerifiedSnapshot,
} from "../server/db/snapshot.js";

// The newest migration. Its body is guarded, so running it again is harmless,
// which makes forgetting its _migrations row the cheapest honest way to turn a
// fully migrated database into one an older build left behind.
const PENDING = "026_projects_archived_at";
const TS = "2026-09-29T00:00:00.000Z";

function rowsIn<T>(file: string, sql: string): T[] {
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}

function filesIn(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort((a, b) => a.localeCompare(b, "en")) : [];
}

function insertProject(db: Database.Database, name: string): void {
  db.prepare(
    "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)"
  ).run(`id-${name}`, name, TS, TS);
}

// Snapshot names carry a millisecond timestamp. Two snapshots of a tiny
// database can land in the same millisecond, where the second would find its
// name taken, so tests that take two in a row wait for the clock to tick.
function nextMillisecond(): void {
  const start = Date.now();
  while (Date.now() === start) {
    // spin: this is at most a millisecond
  }
}

let root: string;
let dbPath: string;
let snapshotDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-premigrate-"));
  dbPath = path.join(root, "vibe-dash.db");
  snapshotDir = path.join(root, "backups", "pre-migration");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/**
 * An open WAL-mode database holding one project and one migration behind this
 * build: the state a real install is in when a newer build starts over it.
 * The project is written without a checkpoint, so it lives only in the WAL,
 * and a snapshot that missed WAL content would miss it.
 */
function dbOneMigrationBehind(file: string = dbPath): Database.Database {
  const db = new Database(file);
  initDb(db, { snapshotDir });
  insertProject(db, "snapshot-me");
  db.prepare("DELETE FROM _migrations WHERE name = ?").run(PENDING);
  return db;
}

/** An open database with data in it and nothing pending, for calling the snapshot module directly. */
function currentDb(): Database.Database {
  const db = new Database(dbPath);
  initDb(db, { snapshotDir });
  insertProject(db, "current");
  return db;
}

/**
 * Break the b-tree page a table lives on, the way disk corruption would. The
 * database still opens (its schema page is untouched), but reading that table
 * fails, and so does anything that copies it.
 */
function corruptTablePage(file: string, table: string): void {
  const db = new Database(file);
  const pageSize = db.pragma("page_size", { simple: true }) as number;
  const { rootpage } = db
    .prepare("SELECT rootpage FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { rootpage: number };
  db.close(); // checkpoints the WAL, so the page below is the one SQLite will read
  const fd = fs.openSync(file, "r+");
  try {
    // The first byte of a b-tree page is its type: 2, 5, 10 or 13. 0 is none of them.
    fs.writeSync(fd, Buffer.from([0]), 0, 1, (rootpage - 1) * pageSize);
  } finally {
    fs.closeSync(fd);
  }
}

describe("pre-migration snapshot (DATA-1)", () => {
  it("writes a verified copy of the data before applying any pending migration", () => {
    const db = dbOneMigrationBehind();
    const report = runMigrations(db, { snapshotDir });
    db.close();

    expect(report.applied).toEqual([PENDING]);
    expect(report.snapshot).not.toBeNull();
    const snapshot = report.snapshot!;
    // Inside this database's own folder under the snapshot directory.
    expect(path.dirname(path.dirname(snapshot.path))).toBe(snapshotDir);
    expect(snapshot.pending).toEqual([PENDING]);

    expect(rowsIn<{ name: string }>(snapshot.path, "SELECT name FROM projects")).toEqual([
      { name: "snapshot-me" },
    ]);
    // Taken before the pending migration was recorded, so restoring it really
    // does put the database back where the older build left it.
    const recorded = rowsIn<{ name: string }>(snapshot.path, "SELECT name FROM _migrations").map(
      (r) => r.name
    );
    expect(recorded).toContain("025_activity_log_timestamp_julianday_index");
    expect(recorded).not.toContain(PENDING);
    expect(rowsIn<{ integrity_check: string }>(snapshot.path, "PRAGMA integrity_check")).toEqual([
      { integrity_check: "ok" },
    ]);
  });

  it("takes no snapshot when no migration is pending", () => {
    const db = new Database(dbPath);
    initDb(db, { snapshotDir });
    insertProject(db, "already-current");

    const report = runMigrations(db, { snapshotDir });
    db.close();

    expect(report.snapshot).toBeNull();
    expect(report.applied).toEqual([]);
    expect(filesIn(snapshotDir)).toEqual([]);
  });

  it("takes no snapshot of a brand-new database, which has nothing to lose", () => {
    // Through initDb, as every entry point opens a new file: it switches to WAL
    // before migrating, which also keeps 26 commits cheap under a loaded suite.
    const db = new Database(dbPath);
    const report = initDb(db, { snapshotDir });
    db.close();

    expect(report.snapshot).toBeNull();
    expect(report.applied[0]).toBe("001_initial_schema");
    expect(report.applied).toContain(PENDING);
    expect(filesIn(snapshotDir)).toEqual([]);
  });

  it("takes no snapshot of an in-memory database, even one with data and a pending migration", () => {
    const db = new Database(":memory:");
    initDb(db, { snapshotDir });
    insertProject(db, "in-memory");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(PENDING);

    const report = runMigrations(db, { snapshotDir });
    db.close();

    expect(report.snapshot).toBeNull();
    expect(report.applied).toEqual([PENDING]);
    expect(filesIn(snapshotDir)).toEqual([]);
  });

  it("refuses to migrate, applying nothing, when the snapshot cannot be written", () => {
    // A regular file where a directory is needed, so creating the snapshot
    // folder fails the way a read-only or full volume would.
    const blocker = path.join(root, "not-a-directory");
    fs.writeFileSync(blocker, "");
    const unwritable = path.join(blocker, "pre-migration");
    const db = dbOneMigrationBehind();
    try {
      runMigrations(db, { snapshotDir: unwritable });
      expect.unreachable("runMigrations should have refused to migrate");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationSnapshotError);
      // The operator needs to know where it tried and what to change.
      expect((err as Error).message).toContain(unwritable);
      expect((err as Error).message).toContain("VIBE_DASH_BACKUP_DIR");
      expect((err as MigrationSnapshotError).databaseProblems).toEqual([]);
    }
    const recorded = db
      .prepare("SELECT COUNT(*) AS n FROM _migrations WHERE name = ?")
      .get(PENDING) as { n: number };
    db.close();
    expect(recorded.n).toBe(0);
  });

  it("blames the database, not the backup folder, when the database itself is damaged", () => {
    dbOneMigrationBehind().close();
    corruptTablePage(dbPath, "projects");

    const db = new Database(dbPath);
    try {
      runMigrations(db, { snapshotDir });
      expect.unreachable("runMigrations should have refused to migrate");
    } catch (err) {
      expect(err).toBeInstanceOf(MigrationSnapshotError);
      expect((err as MigrationSnapshotError).databaseProblems.length).toBeGreaterThan(0);
      // Pointing at free space or permissions here would send the operator
      // after the wrong problem.
      expect((err as Error).message).toContain("database itself is damaged");
      expect((err as Error).message).toContain("npm run backup");
    } finally {
      db.close();
    }
    // The failed copy is not left behind looking like a backup.
    expect(filesIn(preMigrationFolder(snapshotDir, dbPath))).toEqual([]);
  });

  it("releases the owner lock when it refuses to migrate", () => {
    dbOneMigrationBehind().close();
    const blocker = path.join(root, "not-a-directory");
    fs.writeFileSync(blocker, "");

    expect(() => openDb(dbPath, "test", { snapshotDir: path.join(blocker, "pre-migration") })).toThrow(
      MigrationSnapshotError
    );
    // A lock left behind would name a process that may still be alive, and every
    // later start would read it as another owner and refuse to open.
    expect(fs.existsSync(`${dbPath}.owner.lock`)).toBe(false);
  });

  it("puts snapshots under VIBE_DASH_BACKUP_DIR/pre-migration when no folder is passed", () => {
    // This default is what the Docker image relies on to keep snapshots in
    // its volume rather than in the container's throwaway home directory.
    const saved = process.env.VIBE_DASH_BACKUP_DIR;
    process.env.VIBE_DASH_BACKUP_DIR = path.join(root, "env-backups");
    try {
      const db = dbOneMigrationBehind();
      const report = runMigrations(db);
      db.close();
      expect(path.dirname(path.dirname(report.snapshot!.path))).toBe(
        path.join(root, "env-backups", "pre-migration")
      );
    } finally {
      if (saved === undefined) delete process.env.VIBE_DASH_BACKUP_DIR;
      else process.env.VIBE_DASH_BACKUP_DIR = saved;
    }
  });

  it("tells openDb's caller where the snapshot went, so the server and stdio MCP can log it", () => {
    dbOneMigrationBehind().close();

    const seen: string[] = [];
    const db = openDb(dbPath, "test", { snapshotDir, onSnapshot: (s) => seen.push(s.path) });
    db.close();

    expect(seen).toHaveLength(1);
    expect(path.dirname(path.dirname(seen[0]))).toBe(snapshotDir);
    expect(fs.existsSync(seen[0])).toBe(true);
  });

  it("keeps each database's snapshots in its own folder when they share a backup directory", () => {
    // Two installs run by one OS user share ~/.vibe-dash-backups by default.
    // Both databases are called vibe-dash.db, in different places.
    const first = dbOneMigrationBehind();
    const firstReport = runMigrations(first, { snapshotDir });
    first.close();

    const otherPath = path.join(root, "other-install", "vibe-dash.db");
    fs.mkdirSync(path.dirname(otherPath));
    const second = dbOneMigrationBehind(otherPath);
    const secondReport = runMigrations(second, { snapshotDir });
    second.close();

    expect(path.dirname(firstReport.snapshot!.path)).not.toBe(path.dirname(secondReport.snapshot!.path));
    expect(fs.existsSync(firstReport.snapshot!.path)).toBe(true);
    expect(fs.existsSync(secondReport.snapshot!.path)).toBe(true);
  });
});

describe("pre-migration snapshot retention", () => {
  it("keeps one copy of identical snapshots, as a crash-looping container takes on every restart", () => {
    const db = currentDb();
    const first = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    db.close();
    // A restart: the next snapshot comes from a new connection, as it would
    // from a new process, so this also pins that VACUUM INTO writes the same
    // bytes for the same content across one.
    nextMillisecond();
    const reopened = new Database(dbPath);
    const second = takePreMigrationSnapshot(reopened, [PENDING], snapshotDir);
    reopened.close();

    expect(second.pruned).toEqual([first.path]);
    expect(filesIn(path.dirname(second.path))).toEqual([path.basename(second.path)]);
  });

  it("keeps an earlier snapshot of a different state even when it carries the same step label", () => {
    // After a restore, say: the same migration is pending again, but the data
    // is not the data the earlier snapshot holds, so it is not a duplicate.
    const db = currentDb();
    const first = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    insertProject(db, "written-after-the-first-snapshot");
    nextMillisecond();
    const second = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    db.close();

    expect(second.pruned).toEqual([]);
    expect(fs.existsSync(first.path)).toBe(true);
    expect(fs.existsSync(second.path)).toBe(true);
  });

  it("keeps the newest ten and never touches files it did not write", () => {
    const folder = preMigrationFolder(snapshotDir, dbPath);
    fs.mkdirSync(folder, { recursive: true });
    const older = [
      "vibe-dash-2026-01-01T00-00-00-000-pre-001.db",
      "vibe-dash-2026-01-02T00-00-00-000-pre-002.db",
      "vibe-dash-2026-01-03T00-00-00-000-pre-003.db",
      "vibe-dash-2026-01-04T00-00-00-000-pre-004.db",
      "vibe-dash-2026-01-05T00-00-00-000-pre-005.db",
      "vibe-dash-2026-01-06T00-00-00-000-pre-006.db",
      "vibe-dash-2026-01-07T00-00-00-000-pre-007.db",
      "vibe-dash-2026-01-08T00-00-00-000-pre-008.db",
      "vibe-dash-2026-01-09T00-00-00-000-pre-009.db",
      "vibe-dash-2026-01-10T00-00-00-000-pre-010.db",
      "vibe-dash-2026-01-11T00-00-00-000-pre-011.db",
      "vibe-dash-2026-01-12T00-00-00-000-pre-012.db",
    ];
    // A manual `npm run backup` file and a stray note: not ours to prune.
    const unrelated = ["notes.txt", "vibe-dash-2026-01-01T00-00-00-000.db"];
    for (const f of [...older, ...unrelated]) fs.writeFileSync(path.join(folder, f), "");

    const db = currentDb();
    const snapshot = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    db.close();

    const files = filesIn(folder);
    // The three oldest go; the other nine plus the new one make ten.
    for (const gone of older.slice(0, 3)) expect(files).not.toContain(gone);
    for (const kept of older.slice(3)) expect(files).toContain(kept);
    expect(files).toContain(path.basename(snapshot.path));
    for (const f of unrelated) expect(files).toContain(f);
    expect(files).toHaveLength(10 + unrelated.length);
  });

  it("never prunes the snapshot it has just written, however the other names sort", () => {
    // Files stamped in the future (a clock that was wrong for a while, a
    // hand-copied file) sort after the new snapshot's real timestamp.
    const folder = preMigrationFolder(snapshotDir, dbPath);
    fs.mkdirSync(folder, { recursive: true });
    const future = [
      "vibe-dash-2030-01-01T00-00-00-000-pre-001.db",
      "vibe-dash-2030-01-02T00-00-00-000-pre-002.db",
      "vibe-dash-2030-01-03T00-00-00-000-pre-003.db",
      "vibe-dash-2030-01-04T00-00-00-000-pre-004.db",
      "vibe-dash-2030-01-05T00-00-00-000-pre-005.db",
      "vibe-dash-2030-01-06T00-00-00-000-pre-006.db",
      "vibe-dash-2030-01-07T00-00-00-000-pre-007.db",
      "vibe-dash-2030-01-08T00-00-00-000-pre-008.db",
      "vibe-dash-2030-01-09T00-00-00-000-pre-009.db",
      "vibe-dash-2030-01-10T00-00-00-000-pre-010.db",
      "vibe-dash-2030-01-11T00-00-00-000-pre-011.db",
      "vibe-dash-2030-01-12T00-00-00-000-pre-012.db",
    ];
    for (const f of future) fs.writeFileSync(path.join(folder, f), "");

    const db = currentDb();
    const snapshot = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    db.close();

    expect(fs.existsSync(snapshot.path)).toBe(true);
    const files = filesIn(folder);
    for (const gone of future.slice(0, 3)) expect(files).not.toContain(gone);
    for (const kept of future.slice(3)) expect(files).toContain(kept);
    expect(files).toHaveLength(10);
  });

  it("reports a snapshot it could not remove instead of refusing to migrate", () => {
    const folder = preMigrationFolder(snapshotDir, dbPath);
    fs.mkdirSync(folder, { recursive: true });
    // The oldest entry, due for removal, is a directory: a plain delete fails on it.
    const stuck = "vibe-dash-2026-01-01T00-00-00-000-pre-001.db";
    fs.mkdirSync(path.join(folder, stuck));
    fs.writeFileSync(path.join(folder, stuck, "inside"), "");
    for (let day = 2; day <= 10; day++) {
      const dd = String(day).padStart(2, "0");
      fs.writeFileSync(path.join(folder, `vibe-dash-2026-01-${dd}T00-00-00-000-pre-0${dd}.db`), "");
    }

    const db = currentDb();
    const snapshot = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
    db.close();

    expect(fs.existsSync(snapshot.path)).toBe(true);
    expect(snapshot.pruneErrors).toHaveLength(1);
    expect(snapshot.pruneErrors[0]).toContain(stuck);
    expect(fs.existsSync(path.join(folder, stuck))).toBe(true);
  });
});

describe("writeVerifiedSnapshot", () => {
  it("refuses to overwrite a file that is already there", () => {
    const dest = path.join(root, "existing.db");
    fs.writeFileSync(dest, "sentinel");
    const db = currentDb();
    try {
      expect(() => writeVerifiedSnapshot(db, dest)).toThrow(SnapshotError);
    } finally {
      db.close();
    }
    expect(fs.readFileSync(dest, "utf8")).toBe("sentinel");
  });

  it("leaves nothing behind when VACUUM INTO fails", () => {
    const dest = path.join(root, "backups", "never.db");
    fs.mkdirSync(path.dirname(dest));
    const db = currentDb();
    db.exec("BEGIN"); // SQLite refuses VACUUM inside a transaction
    try {
      expect(() => writeVerifiedSnapshot(db, dest)).toThrow(/VACUUM INTO/);
    } finally {
      db.exec("ROLLBACK");
      db.close();
    }
    expect(filesIn(path.dirname(dest))).toEqual([]);
  });

  it("deletes a copy that fails integrity_check rather than keep it as a backup", () => {
    // Real VACUUM INTO output is always sound, so this stands in for the
    // copy step with one that writes garbage where the database should be.
    const garbageWriter = {
      prepare: () => ({ run: (target: string) => fs.writeFileSync(target, "not a database") }),
    } as unknown as Database.Database;
    const dest = path.join(root, "backups", "garbage.db");
    fs.mkdirSync(path.dirname(dest));

    expect(() => writeVerifiedSnapshot(garbageWriter, dest)).toThrow(/integrity_check/);
    expect(filesIn(path.dirname(dest))).toEqual([]);
  });

  it("never has an unverified copy under the backup's real name", () => {
    // A process killed mid-copy must not leave an empty or half-written file
    // named like a backup: restored, an empty one opens as a new database.
    const real = currentDb();
    const dest = path.join(root, "copy.db");
    let destExistedBeforeVerifying: boolean | undefined;
    const watchingCopy = {
      prepare: (sql: string) => {
        const statement = real.prepare(sql);
        return {
          run: (target: string) => {
            const result = statement.run(target);
            // The copy is written but not yet checked: the window a kill
            // would land in.
            destExistedBeforeVerifying = fs.existsSync(dest);
            return result;
          },
        };
      },
    } as unknown as Database.Database;

    writeVerifiedSnapshot(watchingCopy, dest);
    real.close();

    expect(destExistedBeforeVerifying).toBe(false);
    expect(rowsIn<{ name: string }>(dest, "SELECT name FROM projects")).toEqual([{ name: "current" }]);
  });

  it.skipIf(process.platform === "win32")(
    "makes snapshots and their folders readable by their owner only",
    () => {
      const db = currentDb();
      const snapshot = takePreMigrationSnapshot(db, [PENDING], snapshotDir);
      db.close();

      expect(fs.statSync(snapshot.path).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(snapshot.path)).mode & 0o777).toBe(0o700);
    }
  );
});

describe("resolveBackupDir", () => {
  const saved = process.env.VIBE_DASH_BACKUP_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.VIBE_DASH_BACKUP_DIR;
    else process.env.VIBE_DASH_BACKUP_DIR = saved;
  });

  it("honours VIBE_DASH_BACKUP_DIR", () => {
    process.env.VIBE_DASH_BACKUP_DIR = path.join(os.tmpdir(), "somewhere-else");
    expect(resolveBackupDir()).toBe(path.resolve(os.tmpdir(), "somewhere-else"));
  });

  it("defaults to ~/.vibe-dash-backups, outside any working tree a git clean could empty", () => {
    delete process.env.VIBE_DASH_BACKUP_DIR;
    expect(resolveBackupDir()).toBe(path.join(os.homedir(), ".vibe-dash-backups"));
  });
});
