// Consistent online snapshot of the vibe-dash SQLite database (`npm run backup`).
//
// The copy is made with VACUUM INTO by writeVerifiedSnapshot() in
// server/db/snapshot.ts, the same code the server uses for the snapshot it
// takes before applying migrations. VACUUM INTO is safe against a live server
// holding the file open, so this does NOT violate the single-owner rule: it
// never becomes a writer.
//
// Every snapshot is verified before it is kept. A snapshot that fails
// integrity_check is deleted rather than left to look like a good backup.
//
//   npm run backup
//
// Env:
//   VIBE_DASH_DB          source db (default: resolved as for the server, see server/db/path.ts)
//   VIBE_DASH_BACKUP_DIR  destination (default: ~/.vibe-dash-backups)
//   VIBE_DASH_BACKUP_KEEP how many snapshots to retain (default: 14)
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { resolveDbPath } from "../server/db/path.js";
import { resolveBackupDir, snapshotStamp, writeVerifiedSnapshot } from "../server/db/snapshot.js";

const DEFAULT_KEEP = 14;

const fail = (msg: string): never => {
  console.error(`backup-db: FAILED - ${msg}`);
  process.exit(1);
};

// A value that is not a positive whole number falls back to the default rather
// than reaching the rotation below: Math.max(1, Number("two")) is NaN, and
// slice(NaN) would treat every snapshot as stale, the new one included.
function keepCount(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_KEEP;
}

const src = resolveDbPath();
const outDir = resolveBackupDir();
const keep = keepCount(process.env.VIBE_DASH_BACKUP_KEEP);

if (!fs.existsSync(src)) fail(`source database not found: ${src}`);
// Owner-only, like the copies themselves: each one is the whole database.
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

// Report source health, but still take the backup if it is unhealthy.
// A snapshot of a damaged database is far better than no snapshot at all.
const source = new Database(src, { readonly: true });
let srcHealthy = true;
{
  const ic = (source.pragma("integrity_check") as { integrity_check: string }[]).map((r) => r.integrity_check);
  const fk = (source.pragma("foreign_key_check") as unknown[]).length;
  srcHealthy = ic.length === 1 && ic[0] === "ok" && fk === 0;
  if (!srcHealthy) {
    console.warn(
      `backup-db: WARNING source is unhealthy (${ic.length} integrity finding(s), ${fk} fk violation(s)). ` +
        `Backing it up anyway. Repair with REINDEX after stopping all openers.`
    );
  }
}

// Filesystem-safe and chronologically sortable, so rotation can sort by name.
const dest = path.join(outDir, `vibe-dash-${snapshotStamp()}.db`);
let bytes = 0;
let snapshotFailure: string | undefined;
try {
  bytes = writeVerifiedSnapshot(source, dest).bytes;
} catch (err) {
  snapshotFailure = err instanceof Error ? err.message : String(err);
} finally {
  source.close();
}
if (snapshotFailure !== undefined) fail(snapshotFailure);

{
  const copy = new Database(dest, { readonly: true });
  let fk: number;
  let tasks: number;
  try {
    fk = (copy.pragma("foreign_key_check") as unknown[]).length;
    tasks = (copy.prepare("select count(*) c from tasks").get() as { c: number }).c;
  } finally {
    copy.close();
  }
  const size = (bytes / 1024 / 1024).toFixed(1);
  console.log(
    `backup-db: ok  ${path.basename(dest)}  ${size} MB  tasks=${tasks}  fk_violations=${fk}` +
      (srcHealthy ? "" : "  (source was unhealthy)")
  );
}

// Rotate: keep the newest `keep` snapshots, delete older ones. Only names in
// exactly the form this script writes match, so an operator's own
// vibe-dash-something.db in the same folder is never touched, and neither is
// the server's pre-migration subfolder. A file that cannot be removed is
// reported rather than failing a backup that has already succeeded.
{
  const snaps = fs
    .readdirSync(outDir)
    .filter((f) => /^vibe-dash-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.db$/.test(f))
    .sort((a, b) => b.localeCompare(a, "en"));
  const stale = snaps.slice(keep);
  for (const f of stale) {
    try {
      fs.rmSync(path.join(outDir, f), { force: true });
    } catch (err) {
      console.warn(`backup-db: WARNING could not remove ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(
    `backup-db: retained ${Math.min(snaps.length, keep)} of ${snaps.length}` +
      (stale.length ? `, pruned ${stale.length}` : "")
  );
}
