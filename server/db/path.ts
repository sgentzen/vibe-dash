// All path.join/resolve calls in this file operate on operator-controlled inputs
// (VIBE_DASH_DB env var, CLI override, __dirname, git internals). They are never
// reached from HTTP/MCP request data, so the path-traversal rule is a false positive.
// nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve a worktree `.git` pointer (`gitdir: <path>`) back to the main repo root.
function resolveWorktreePointer(dir: string, gitFileContent: string): string | null {
  // Anchor the capture on a non-whitespace char (\S) so `\s*` and the capture
  // group can't both match the leading spaces — that overlap is what makes the
  // naive `\s*(.+)` form backtrack super-linearly (S8786). exec() over match()
  // for a single non-global lookup (S6594).
  const match = /^gitdir:\s*(\S.*)$/m.exec(gitFileContent);
  if (!match) return null;

  const gitdir = path.resolve(dir, match[1].trim());

  // Standard layout: gitdir = `<repo>/.git/worktrees/<name>` → repo root is two levels above.
  const grandparent = path.dirname(path.dirname(gitdir));
  if (path.basename(grandparent) === ".git") return path.dirname(grandparent);

  // Non-standard layout: `commondir` file holds the path to the main `.git`.
  const commondirFile = path.join(gitdir, "commondir");
  if (fs.existsSync(commondirFile)) {
    const commondir = path.resolve(gitdir, fs.readFileSync(commondirFile, "utf8").trim());
    if (path.basename(commondir) === ".git") return path.dirname(commondir);
  }

  // Last resort: walk upward from the gitdir's parent (avoids reproducing the
  // per-worktree-DB bug by returning the worktree dir itself).
  return findRepoRoot(path.dirname(gitdir));
}

// Walk up from `start` looking for a `.git` directory or file. If `.git` is a
// file (the worktree pointer format `gitdir: <path>`), follow it back to the
// main repository root so every worktree resolves to the same root.
function findRepoRoot(start: string): string | null {
  let dir = path.resolve(start);
  while (true) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      if (fs.statSync(gitPath).isDirectory()) return dir;
      const resolved = resolveWorktreePointer(dir, fs.readFileSync(gitPath, "utf8"));
      return resolved ?? dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the SQLite path used by the server, MCP transports, and CLI.
 *
 * Priority:
 *   1. Explicit override (CLI flag or argument)
 *   2. `VIBE_DASH_DB` env var
 *   3. `<git-common-root>/vibe-dash.db` — same DB across all worktrees of a repo
 *   4. Two levels above this file (`server/db/..` -> repo root) as a non-git fallback
 *
 * Always returns an absolute path so the caller can log it unambiguously.
 */
export function resolveDbPath(override?: string | null | undefined): string {
  if (override && override.length > 0) return path.resolve(override);
  if (process.env.VIBE_DASH_DB && process.env.VIBE_DASH_DB.length > 0) {
    return path.resolve(process.env.VIBE_DASH_DB);
  }

  const repoRoot = findRepoRoot(__dirname);
  if (repoRoot) return path.join(repoRoot, "vibe-dash.db");

  return path.resolve(__dirname, "..", "..", "vibe-dash.db");
}
