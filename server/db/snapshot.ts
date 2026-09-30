// VACUUM INTO snapshots of the SQLite database: the one implementation behind
// both `npm run backup` (scripts/backup-db.ts) and the snapshot the migration
// runner takes before applying pending migrations (DATA-1).
//
// Every path here comes from operator-controlled inputs (VIBE_DASH_BACKUP_DIR,
// the database path, file names this module builds itself). None of it is
// reachable from HTTP or MCP request data.
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BACKUP_DIR_ENV = "VIBE_DASH_BACKUP_DIR";

/** Folder under the backup directory that holds pre-migration snapshots. */
const PRE_MIGRATION_SUBDIR = "pre-migration";

/**
 * How many pre-migration snapshots to keep for one database. There is one per
 * distinct state an upgrade started from, so ten reaches several upgrades
 * back; older ones go because each is a full copy of the database.
 */
export const PRE_MIGRATION_KEEP = 10;

// Owner-only, because every snapshot is a full copy of the database. Both are
// no-ops on Windows, where the folder inherits the user profile's ACL instead.
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

// vibe-dash-<stamp>-pre-<step>.db. The stamp comes first so that name order is
// time order. <step> names the migration the snapshot was taken before; it is
// a label for people, and retention never decides anything from it.
const PRE_MIGRATION_FILE = /^vibe-dash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-pre-\w+\.db$/;

/**
 * Which part of taking a snapshot failed. "destination" is the folder or file
 * being written to; "copy" and "verify" involve reading the database, so only
 * those can mean the database itself is damaged.
 */
export type SnapshotStage = "destination" | "copy" | "verify";

export class SnapshotError extends Error {
  readonly stage: SnapshotStage;

  constructor(stage: SnapshotStage, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SnapshotError";
    this.stage = stage;
  }
}

/** A verified pre-migration snapshot, as reported back to the entry point. */
export interface PreMigrationSnapshot {
  /** Absolute path of the verified copy. */
  path: string;
  bytes: number;
  /** The migrations about to be applied: what restoring this copy undoes. */
  pending: string[];
  /** Older snapshots removed by retention. */
  pruned: string[];
  /**
   * Old snapshots that could not be removed, or a folder that could not be
   * listed. The new snapshot is sound; these only mean retention left files
   * behind, which is worth a warning, not a refusal to start.
   */
  pruneErrors: string[];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Where backups go: `VIBE_DASH_BACKUP_DIR` if set, else `~/.vibe-dash-backups`.
 * The default is deliberately outside the git working tree the database itself
 * defaults to, so a single `git clean -xdf` cannot remove the database and its
 * backups together (DATA-13).
 */
export function resolveBackupDir(): string {
  const configured = process.env[BACKUP_DIR_ENV];
  if (configured && configured.length > 0) return path.resolve(configured);
  return path.join(os.homedir(), ".vibe-dash-backups");
}

/** Where pre-migration snapshots go unless the caller names a folder. */
export function preMigrationSnapshotDir(): string {
  return path.join(resolveBackupDir(), PRE_MIGRATION_SUBDIR);
}

/**
 * The folder one database's pre-migration snapshots live in under `root`:
 * `<file name>-<first 12 hex digits of the SHA-256 of its absolute path>`.
 * Keyed by database because the default backup folder is shared by every
 * install one OS user runs, and retention must never delete one database's
 * only pre-upgrade copy to make room for another's. The name keeps the folder
 * readable; the hash keeps two `vibe-dash.db` files in different places apart.
 */
export function preMigrationFolder(root: string, dbPath: string): string {
  const absolute = path.resolve(dbPath);
  const name = path.basename(absolute, path.extname(absolute)) || "database";
  const key = crypto.createHash("sha256").update(absolute).digest("hex").slice(0, 12);
  return path.join(root, `${name}-${key}`);
}

/** Filesystem-safe timestamp that sorts chronologically as a plain string. */
export function snapshotStamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-").replace("Z", "");
}

/** `integrity_check` findings for the database at `file`; empty means healthy. */
function integrityProblems(file: string): string[] {
  let copy: Database.Database | undefined;
  try {
    copy = new Database(file, { readonly: true, fileMustExist: true });
    const findings = (copy.pragma("integrity_check") as { integrity_check: string }[]).map(
      (r) => r.integrity_check
    );
    return findings.length === 1 && findings[0] === "ok" ? [] : findings;
  } catch (err) {
    return [messageOf(err)];
  } finally {
    copy?.close();
  }
}

/**
 * Write a consistent copy of `db` to `dest` with VACUUM INTO, then prove the
 * copy is a healthy database before calling it a backup. A copy that fails
 * `integrity_check` is deleted and SnapshotError thrown: a backup that cannot
 * be restored is worse than none, because it looks like one.
 *
 * VACUUM INTO reads one transaction-consistent view, so it is safe against a
 * live writer, and it includes committed pages still sitting in the WAL.
 * SQLite refuses it inside a transaction. The copy is readable by its owner
 * only, and `dest` must not exist yet: this never overwrites a file.
 *
 * The copy is written and verified under `<dest>.partial` and only renamed to
 * `dest` once it has passed, so a file under a backup's real name is always a
 * verified one. A process killed mid-copy leaves a `.partial` behind, which no
 * retention rule or restore instruction ever mistakes for a backup; left under
 * the real name, an empty copy would restore as a brand-new database.
 */
export function writeVerifiedSnapshot(
  db: Database.Database,
  dest: string
): { path: string; bytes: number } {
  if (fs.existsSync(dest)) {
    throw new SnapshotError("destination", `${dest} already exists; refusing to overwrite it`);
  }
  const partial = `${dest}.partial`;
  // Claim the working name atomically: "wx" fails if anything is already
  // there, including a file another process creates in the same instant, so
  // whatever is at `partial` from here on is ours to delete. VACUUM INTO
  // accepts an existing empty file, writes the same bytes into it as into a
  // new one, and keeps the owner-only mode set here.
  try {
    fs.closeSync(fs.openSync(partial, "wx", PRIVATE_FILE_MODE));
  } catch (err) {
    throw new SnapshotError("destination", `cannot create ${partial}: ${messageOf(err)}`, { cause: err });
  }
  try {
    try {
      db.prepare("VACUUM INTO ?").run(partial);
    } catch (err) {
      throw new SnapshotError("copy", `VACUUM INTO ${partial} failed: ${messageOf(err)}`, { cause: err });
    }
    const problems = integrityProblems(partial);
    if (problems.length > 0) {
      throw new SnapshotError(
        "verify",
        `the copy of the database failed integrity_check (${problems.slice(0, 3).join(" | ")}) and has been deleted`
      );
    }
    try {
      fs.renameSync(partial, dest);
    } catch (err) {
      throw new SnapshotError("destination", `cannot rename ${partial} to ${dest}: ${messageOf(err)}`, {
        cause: err,
      });
    }
  } catch (err) {
    // Its own try, so that a failed cleanup (a virus scanner holding the file
    // on Windows, say) cannot replace the error that explains what went wrong.
    try {
      fs.rmSync(partial, { force: true });
    } catch {
      // A leftover .partial is inert: nothing matches or restores it.
    }
    throw err;
  }
  return { path: dest, bytes: fs.statSync(dest).size };
}

/** SHA-256 of a file, read in chunks so a large database is never held in memory whole. */
function sha256OfFile(file: string): string {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    for (let read = fs.readSync(fd, buffer); read > 0; read = fs.readSync(fd, buffer)) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** "026_projects_archived_at" -> "026": the step a snapshot is taken before. */
function stepOf(migration: string): string {
  return /^(\d+)_/.exec(migration)?.[1] ?? migration;
}

/**
 * Keep one database's pre-migration folder bounded without ever losing a state
 * it holds only one copy of.
 *
 * An older snapshot is deleted as a duplicate only when it is byte-identical
 * to the one just written. VACUUM INTO output is deterministic for identical
 * content, so this collapses exactly the copies a container crash-looping on
 * one failing migration takes on every restart, while a snapshot that shares
 * the new one's step label but holds different data (after a restore, say) is
 * kept. Deciding by content rather than by label is the point: a label cannot
 * tell those two cases apart.
 *
 * Past that, the newest PRE_MIGRATION_KEEP stay. The snapshot just written is
 * always one of them however the others' names sort, so a stray file with a
 * future timestamp cannot push it out. Names that do not match this module's
 * own pattern are never touched.
 */
function prunePreMigrationSnapshots(
  dir: string,
  justWritten: { name: string; bytes: number }
): { pruned: string[]; pruneErrors: string[] } {
  const pruned: string[] = [];
  const pruneErrors: string[] = [];

  let others: string[];
  try {
    others = fs
      .readdirSync(dir)
      .filter((name) => name !== justWritten.name && PRE_MIGRATION_FILE.test(name))
      .sort((a, b) => b.localeCompare(a, "en"));
  } catch (err) {
    return { pruned, pruneErrors: [`${dir}: ${messageOf(err)}`] };
  }

  let newHash: string | undefined;
  const isCopyOfNew = (name: string): boolean => {
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).size !== justWritten.bytes) return false;
      newHash ??= sha256OfFile(path.join(dir, justWritten.name));
      return sha256OfFile(file) === newHash;
    } catch {
      // Unreadable, or not a file at all: not provably a duplicate, so it is
      // kept here and left to the count limit below.
      return false;
    }
  };

  const duplicates = others.filter(isCopyOfNew);
  const distinct = others.filter((name) => !duplicates.includes(name));
  const doomed = [...duplicates, ...distinct.slice(PRE_MIGRATION_KEEP - 1)];

  for (const name of doomed) {
    const file = path.join(dir, name);
    try {
      fs.rmSync(file, { force: true });
      pruned.push(file);
    } catch (err) {
      pruneErrors.push(`${file}: ${messageOf(err)}`);
    }
  }
  return { pruned, pruneErrors };
}

/**
 * Snapshot `db` before `pending` migrations are applied, into its own folder
 * under `root`, then apply retention. Throws if the folder cannot be created
 * or the snapshot cannot be written and verified; the caller must not migrate
 * when it does.
 */
export function takePreMigrationSnapshot(
  db: Database.Database,
  pending: string[],
  root: string
): PreMigrationSnapshot {
  if (pending.length === 0) throw new SnapshotError("destination", "no pending migrations to snapshot before");
  const dir = preMigrationFolder(root, db.name);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  } catch (err) {
    throw new SnapshotError("destination", `cannot create ${dir}: ${messageOf(err)}`, { cause: err });
  }
  const name = `vibe-dash-${snapshotStamp()}-pre-${stepOf(pending[0])}.db`;
  const written = writeVerifiedSnapshot(db, path.join(dir, name));
  return { ...written, pending, ...prunePreMigrationSnapshots(dir, { name, bytes: written.bytes }) };
}
