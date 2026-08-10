import type Database from "better-sqlite3";

/**
 * Canonical form of a directory path for storage and comparison.
 *
 * Deliberately pure string manipulation with no filesystem access: a historical
 * transcript can name a directory that no longer exists, and attribution must
 * not depend on the path still being resolvable.
 *
 * Lowercasing is Windows-only because NTFS is case-insensitive while ext4 is
 * not, so folding case on Linux would merge two genuinely different directories.
 */
export function normalisePath(raw: string): string {
  const forward = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? forward.toLowerCase() : forward;
}

interface PathRow { project_id: string; path: string }

/**
 * Build a cwd-to-project resolver over the current project_paths table.
 *
 * Reads the table once and matches in memory: a scan can process thousands of
 * records and the table is tiny, so a query per record would be wasteful.
 * Returns null when nothing matches, which surfaces as Unattributed.
 */
export function buildAttributor(db: Database.Database): (cwd: string | null) => string | null {
  const rows = db.prepare(`SELECT project_id, path FROM project_paths`).all() as PathRow[];
  // Longest first, so the most specific link wins for nested directories.
  const sorted = [...rows].sort((a, b) => b.path.length - a.path.length);

  return (cwd: string | null): string | null => {
    if (cwd === null) return null;
    const target = normalisePath(cwd);

    for (const row of sorted) {
      if (target === row.path) return row.project_id;
      // The separator check is what stops "C:/repos/demo" claiming
      // "C:/repos/demo-old", which is a different directory entirely.
      if (target.startsWith(`${row.path}/`)) return row.project_id;
    }
    return null;
  };
}
