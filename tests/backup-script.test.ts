import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { initDb } from "../server/db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "..", "scripts", "backup-db.ts");
const TS = "2026-09-29T00:00:00.000Z";

// `npm run backup`, run the way npm runs it: its own process, configured only
// through the environment.
function runBackup(env: Record<string, string>): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, ["--import", "tsx", SCRIPT], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function snapshotsIn(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^vibe-dash-.*\.db$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));
}

describe("npm run backup", () => {
  let root: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-backup-script-"));
    dbPath = path.join(root, "vibe-dash.db");
    backupDir = path.join(root, "backups");
    const db = new Database(dbPath);
    initDb(db, { snapshotDir: path.join(root, "unused") });
    db.prepare(
      "INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)"
    ).run("p-1", "backed-up", TS, TS);
    db.close();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("writes a verified snapshot of VIBE_DASH_DB into VIBE_DASH_BACKUP_DIR", () => {
    const { status, output } = runBackup({ VIBE_DASH_DB: dbPath, VIBE_DASH_BACKUP_DIR: backupDir });

    expect(status, output).toBe(0);
    const snapshots = snapshotsIn(backupDir);
    expect(snapshots).toHaveLength(1);
    const copy = new Database(path.join(backupDir, snapshots[0]), { readonly: true });
    try {
      expect(copy.prepare("SELECT name FROM projects").all()).toEqual([{ name: "backed-up" }]);
    } finally {
      copy.close();
    }
  });

  it("keeps only VIBE_DASH_BACKUP_KEEP snapshots and leaves the pre-migration folder alone", () => {
    fs.mkdirSync(path.join(backupDir, "pre-migration"), { recursive: true });
    const oldest = "vibe-dash-2026-01-01T00-00-00-000.db";
    const older = "vibe-dash-2026-01-02T00-00-00-000.db";
    const preMigration = path.join(backupDir, "pre-migration", "vibe-dash-2026-01-03T00-00-00-000-pre-026.db");
    for (const f of [path.join(backupDir, oldest), path.join(backupDir, older), preMigration]) {
      fs.writeFileSync(f, "");
    }

    const { status, output } = runBackup({
      VIBE_DASH_DB: dbPath,
      VIBE_DASH_BACKUP_DIR: backupDir,
      VIBE_DASH_BACKUP_KEEP: "2",
    });

    expect(status, output).toBe(0);
    const snapshots = snapshotsIn(backupDir);
    expect(snapshots).toHaveLength(2);
    expect(snapshots).not.toContain(oldest);
    expect(snapshots).toContain(older);
    expect(fs.existsSync(preMigration)).toBe(true);
  });

  it("never rotates away a file whose name it did not write, even one that starts vibe-dash-", () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const operatorsOwn = "vibe-dash-before-the-big-cleanup.db";
    fs.writeFileSync(path.join(backupDir, operatorsOwn), "");

    const { status, output } = runBackup({
      VIBE_DASH_DB: dbPath,
      VIBE_DASH_BACKUP_DIR: backupDir,
      VIBE_DASH_BACKUP_KEEP: "1",
    });

    expect(status, output).toBe(0);
    expect(fs.existsSync(path.join(backupDir, operatorsOwn))).toBe(true);
    // And it did not count as a snapshot either: a name like this sorts after
    // any timestamp, so treating it as one would keep it as "newest" and
    // rotate the backup just taken away instead.
    const stamped = fs
      .readdirSync(backupDir)
      .filter((f) => /^vibe-dash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.db$/.test(f));
    expect(stamped).toHaveLength(1);
  });

  it("fails with a clear message when the source database does not exist", () => {
    const { status, output } = runBackup({
      VIBE_DASH_DB: path.join(root, "no-such.db"),
      VIBE_DASH_BACKUP_DIR: backupDir,
    });

    expect(status).toBe(1);
    expect(output).toContain("source database not found");
  });

  it("still backs up a source that fails its health check, and says so", () => {
    // A task pointing at a project that does not exist: foreign_key_check
    // reports it, but the file is otherwise sound. A copy of a damaged
    // database beats no copy, so this must warn, not refuse.
    const db = new Database(dbPath);
    db.pragma("foreign_keys = OFF"); // better-sqlite3 enforces them by default
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("t-orphan", "no-such-project", "orphan", TS, TS);
    db.close();

    const { status, output } = runBackup({ VIBE_DASH_DB: dbPath, VIBE_DASH_BACKUP_DIR: backupDir });

    expect(status, output).toBe(0);
    expect(output).toContain("WARNING source is unhealthy");
    expect(snapshotsIn(backupDir)).toHaveLength(1);
  });

  it("falls back to its default retention when VIBE_DASH_BACKUP_KEEP is not a number", () => {
    // Math.max(1, Number("two")) is NaN, and slice(NaN) is slice(0): a typo in
    // the variable used to make rotation delete every snapshot, the new one
    // included, and still exit 0.
    fs.mkdirSync(backupDir, { recursive: true });
    const earlier = "vibe-dash-2026-01-01T00-00-00-000.db";
    fs.writeFileSync(path.join(backupDir, earlier), "");

    const { status, output } = runBackup({
      VIBE_DASH_DB: dbPath,
      VIBE_DASH_BACKUP_DIR: backupDir,
      VIBE_DASH_BACKUP_KEEP: "two",
    });

    expect(status, output).toBe(0);
    const snapshots = snapshotsIn(backupDir);
    expect(snapshots).toHaveLength(2);
    expect(snapshots).toContain(earlier);
  });
});
