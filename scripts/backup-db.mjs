#!/usr/bin/env node
// Consistent online snapshot of the vibe-dash SQLite database.
//
// Uses VACUUM INTO, which is safe against a live server holding the file open,
// so this does NOT violate the single-owner rule: it never becomes a writer.
//
// Every snapshot is verified before it is kept. A snapshot that fails
// integrity_check is deleted rather than left to look like a good backup.
//
//   node scripts/backup-db.mjs
//
// Env:
//   VIBE_DASH_DB          source db (default: <repo root>/vibe-dash.db)
//   VIBE_DASH_BACKUP_DIR  destination (default: ~/.vibe-dash-backups)
//   VIBE_DASH_BACKUP_KEEP how many snapshots to retain (default: 14)

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const src = path.resolve(process.env.VIBE_DASH_DB || path.join(repoRoot, "vibe-dash.db"));
const outDir = path.resolve(
  process.env.VIBE_DASH_BACKUP_DIR || path.join(os.homedir(), ".vibe-dash-backups"),
);
const keep = Math.max(1, Number(process.env.VIBE_DASH_BACKUP_KEEP || 14));

const fail = (msg) => {
  console.error(`backup-db: FAILED - ${msg}`);
  process.exit(1);
};

if (!fs.existsSync(src)) fail(`source database not found: ${src}`);
fs.mkdirSync(outDir, { recursive: true });

// Timestamp is filesystem-safe and sorts chronologically as a string.
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "");
const dest = path.join(outDir, `vibe-dash-${stamp}.db`);

// Report source health, but still take the backup if it is unhealthy.
// A snapshot of a damaged database is far better than no snapshot at all.
let srcHealthy = true;
{
  const db = new Database(src, { readonly: true });
  try {
    const ic = db.pragma("integrity_check").map((r) => r.integrity_check);
    const fk = db.pragma("foreign_key_check").length;
    srcHealthy = ic.length === 1 && ic[0] === "ok" && fk === 0;
    if (!srcHealthy) {
      console.warn(
        `backup-db: WARNING source is unhealthy (${ic.length} integrity finding(s), ${fk} fk violation(s)). ` +
          `Backing it up anyway. Repair with REINDEX after stopping all openers.`,
      );
    }
  } finally {
    db.close();
  }
}

// VACUUM INTO produces a consistent snapshot without blocking the owner.
{
  const db = new Database(src, { readonly: true });
  try {
    db.prepare("VACUUM INTO ?").run(dest);
  } catch (err) {
    db.close();
    if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    fail(`VACUUM INTO failed: ${err.message}`);
  }
  db.close();
}

// Verify the snapshot itself. An unverified backup is not a backup.
{
  const db = new Database(dest, { readonly: true });
  let ic, fk, tasks;
  try {
    ic = db.pragma("integrity_check").map((r) => r.integrity_check);
    fk = db.pragma("foreign_key_check").length;
    tasks = db.prepare("select count(*) c from tasks").get().c;
  } finally {
    db.close();
  }
  const ok = ic.length === 1 && ic[0] === "ok";
  if (!ok) {
    fs.rmSync(dest, { force: true });
    fail(`snapshot failed integrity_check (${ic.slice(0, 3).join(" | ")}); snapshot deleted`);
  }
  const size = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
  console.log(
    `backup-db: ok  ${path.basename(dest)}  ${size} MB  tasks=${tasks}  fk_violations=${fk}` +
      (srcHealthy ? "" : "  (source was unhealthy)"),
  );
}

// Rotate: keep the newest `keep` snapshots, delete older ones.
{
  const snaps = fs
    .readdirSync(outDir)
    .filter((f) => /^vibe-dash-.*\.db$/.test(f))
    .sort()
    .reverse();
  const stale = snaps.slice(keep);
  for (const f of stale) fs.rmSync(path.join(outDir, f), { force: true });
  console.log(
    `backup-db: retained ${Math.min(snaps.length, keep)} of ${snaps.length}` +
      (stale.length ? `, pruned ${stale.length}` : ""),
  );
}
