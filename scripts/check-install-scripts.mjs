/**
 * Guards the `npm ci --ignore-scripts` hardening in CI and the Dockerfile.
 *
 * Those installs skip every package lifecycle script, then rebuild only the
 * packages that genuinely need one. That allowlist is a snapshot of the tree,
 * and `npm rebuild <name>` exits 0 even when the name matches nothing — so
 * without this check a dependency bump could add (or rename) an install script
 * and nobody would notice: the package would silently never be built.
 *
 * package-lock.json already records this as `hasInstallScript`, so the lockfile
 * is the source of truth. Any drift from the allowlist fails the build loudly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Packages allowed to run install scripts, and why each is trusted.
 *
 * `fsevents` is optional and darwin-only, so it never installs on the Linux CI
 * runners or the Alpine image — it appears here for macOS contributors, where
 * skipping its build degrades file watching to polling but breaks nothing.
 */
const ALLOWED = new Map([
  ["better-sqlite3", "native SQLite addon: prebuild-install, else node-gyp"],
  ["esbuild", "unpacks its platform binary (pulled in by tsx)"],
  ["fsevents", "optional, darwin-only file watcher"],
]);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));

const MARKER = "node_modules/";

/** "node_modules/a/node_modules/@s/b" -> "@s/b"; anything else is returned as-is. */
function packageName(path) {
  const at = path.lastIndexOf(MARKER);
  return at === -1 ? path : path.slice(at + MARKER.length);
}

const found = new Set(
  Object.entries(lock.packages)
    .filter(([, meta]) => meta.hasInstallScript)
    .map(([path]) => packageName(path))
);

const unreviewed = [...found].filter((name) => !ALLOWED.has(name)).sort((a, b) => a.localeCompare(b, "en"));

if (unreviewed.length > 0) {
  console.error(
    `Dependencies with unreviewed install scripts: ${unreviewed.join(", ")}\n\n` +
      `The CI and Docker installs run with --ignore-scripts, so these packages will\n` +
      `NEVER have their install scripts run. Either confirm that is harmless and add\n` +
      `them to ALLOWED in scripts/check-install-scripts.mjs, or add them to the\n` +
      `'npm rebuild' lists in .github/workflows/ci.yml and the Dockerfile.`
  );
  process.exit(1);
}

// Finding nothing at all means the lockfile shape changed under us (or it was
// read from the wrong place). Treat it as a broken check, not a clean bill of
// health — a vacuous pass is exactly the silent rot this guard exists to catch.
if (found.size === 0) {
  console.error(
    "No packages with install scripts found at all. package-lock.json is empty, " +
      "unreadable, or no longer records `hasInstallScript` — this check is not working."
  );
  process.exit(1);
}

// A name in the allowlist that has left the tree is stale, not dangerous — the
// rebuild silently no-ops. Warn so the list stays honest without failing a build.
const stale = [...ALLOWED.keys()].filter((name) => !found.has(name));
if (stale.length > 0) console.warn(`note: allowlisted but no longer in the lockfile: ${stale.join(", ")}`);

console.log(`Install-script allowlist OK (${[...found].sort((a, b) => a.localeCompare(b, "en")).join(", ")})`);
