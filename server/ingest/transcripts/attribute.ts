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
/** Character code for "/", used by the index-based trim below. */
const SLASH = 47;

export function normalisePath(raw: string): string {
  const forward = raw.replace(/\\/g, "/");
  // Strip trailing slashes, but never down to the empty string. "/" is all
  // slash, and collapsing it to "" turns the prefix test in buildAttributor
  // into `target.startsWith("/")`, which is true of every POSIX path on the
  // machine: one link would silently claim every transcript on disk for one
  // project. A wrong attribution is worse than no attribution, so a lone root
  // stays "/" and matches only itself.
  //
  // Trimmed by index rather than with /\/+$/, deliberately. This runs on the
  // `path` field of POST /api/ingest/paths, so the input is request-controlled,
  // and a trailing-slash regex backtracks super-linearly on a string of many
  // slashes (CodeQL js/polynomial-redos). Walking backwards is linear, and
  // stopping at index 1 gives the "never collapse to empty" floor for free.
  let end = forward.length;
  while (end > 1 && forward.charCodeAt(end - 1) === SLASH) end--;
  const normalised = forward.slice(0, end);
  return process.platform === "win32" ? normalised.toLowerCase() : normalised;
}

/**
 * True for a path that names a whole filesystem or a whole drive.
 *
 * Rejected at the link boundary rather than matched. Linking a root means
 * every transcript on the machine lands on one project, and since the
 * originating `cwd` is never stored there would be no way to see that it had
 * happened, let alone unpick it.
 */
export function isRootPath(normalised: string): boolean {
  return normalised === "/" || /^[a-z]:$/i.test(normalised);
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
