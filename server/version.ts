import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build and version identity for GET /api/health (LIVE-3).
 *
 * The running container that prompted this had no way to tell the maintainer
 * it was nine days stale — `/api/health` returned only `{ ok: true }` and the
 * UI showed nothing. Resolved once at module load, not per-request: none of
 * this changes while the process is running, and computing it lazily would
 * mean paying the `git rev-parse` fallback's cost (or its failure) on every
 * health check instead of once at startup.
 */

/**
 * Same two-layout probe as resolveDistDir() in server/index.ts: dev/tsx runs
 * from <root>/server, a compiled build runs from <pkg>/dist/server.
 *
 * Exported (not just the resolved `version` constant below) so tests can call
 * it directly after mocking `fs.readFileSync` to exercise the not-found and
 * malformed-package.json fallbacks, which no test could otherwise reach —
 * the module-level constants are computed once at import time from whatever
 * is really on disk.
 */
export function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, "..", "package.json"), // dev/tsx: <root>/server -> <root>/package.json
    path.resolve(__dirname, "..", "..", "package.json"), // compiled: <pkg>/dist/server -> <pkg>/package.json
  ];
  for (const candidate of candidates) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
    } catch {
      // Try the next candidate; a missing/unreadable/malformed package.json
      // at one layout is not fatal to a health-check field.
    }
  }
  return "unknown";
}

/**
 * Commit SHA. In Docker this is baked in at build time (see the Dockerfile's
 * `VIBE_DASH_COMMIT_SHA` build ARG, threaded through by docker-compose.yml's
 * `build.args`), because the built image carries no `.git` directory to ask.
 * A native run has no such ARG, so it falls back to asking git directly —
 * "unknown" only if that also fails (no git installed, or run from a source
 * tarball with no `.git`).
 *
 * Exported for the same reason as readPackageVersion() above: it reads
 * `process.env` and shells out fresh on every call, so a test can set
 * `VIBE_DASH_COMMIT_SHA` (including to `""`, to exercise "set but empty
 * falls through") and call this directly, rather than being stuck with
 * whatever `commit` resolved to once at import time.
 */
export function resolveCommit(): string {
  const fromEnv = process.env.VIBE_DASH_COMMIT_SHA;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000, // Runs once at startup, but a hung git must not hang the server with it.
    }).toString().trim();
  } catch {
    return "unknown"; // No git binary, or not a git checkout (e.g. built image, source tarball).
  }
}

/**
 * Build timestamp. Only Docker sets this (`VIBE_DASH_BUILD_TIME` build ARG,
 * same path as the commit SHA above) — a native run has no discrete "build"
 * step to timestamp, `npm start`/`npm run serve` runs source directly, so
 * "unknown" is the honest answer there rather than substituting the process
 * start time, which would look like a build date without being one.
 */
export function resolveBuildTime(): string {
  const fromEnv = process.env.VIBE_DASH_BUILD_TIME;
  return fromEnv && fromEnv.length > 0 ? fromEnv : "unknown";
}

export const version = readPackageVersion();
export const commit = resolveCommit();
export const buildTime = resolveBuildTime();
