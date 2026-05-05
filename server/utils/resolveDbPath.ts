import path from "path";
import { execFileSync } from "child_process";

/**
 * Resolves the vibe-dash SQLite database path.
 *
 * Uses `git rev-parse --git-common-dir` so that worktrees share the main
 * repo's database instead of creating an isolated empty one in the worktree
 * directory. Falls back to `<projectRoot>/vibe-dash.db` when git is
 * unavailable or the directory is not a git repository.
 */
export function resolveDbPath(projectRoot: string): string {
  if (process.env.VIBE_DASH_DB) return process.env.VIBE_DASH_DB;
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
    return path.join(path.resolve(projectRoot, commonDir, ".."), "vibe-dash.db");
  } catch {
    return path.join(projectRoot, "vibe-dash.db");
  }
}
