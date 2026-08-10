// Runs vitest, optionally holding one of N machine-wide test slots.
//
// Why this exists: several agent sessions can work on this machine at once, and
// each running the full suite oversubscribes the box. A wrapper at
// ~/.claude/bin/testslot.py hands out a limited number of slots; a run waits its
// turn rather than piling on.
//
// Why it is a Node shim rather than the npm script calling python directly:
// that form was tried (commit 40d84f7) and cannot ship. It hardcodes
// `%USERPROFILE%` (cmd.exe syntax that never expands on a Linux runner) and
// `vitest.cmd` (Windows-only), so `npm run test:coverage` — which is exactly
// what CI runs — would fail on every GitHub Actions run.
//
// So this shim degrades instead of assuming. It runs vitest directly, with no
// slot, whenever slot-holding is impossible or unwanted:
//
//   * in CI            — runners are already isolated, one job per VM, and the
//                        wrapper does not exist there
//   * wrapper absent   — this is a public repo; a contributor who has never
//                        heard of testslot.py must still get a working
//                        `npm test`, not an ENOENT
//   * python absent    — same reasoning
//
// In every case the exit code is vitest's own, so callers cannot tell whether a
// slot was held.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const vitestArgs = process.argv.slice(2);

// Invoke vitest's JS entrypoint with the current node binary, rather than the
// node_modules/.bin shim. Two problems are avoided at once:
//   * PATH — npm injects .bin into PATH only for npm scripts, so a bare
//     `vitest` works under `npm test` and fails under a direct `node` call.
//   * Windows — the .bin entry is `vitest.cmd`, and since the CVE-2024-27980
//     mitigation Node refuses to spawn .cmd/.bat without `shell: true`. Using a
//     shell to work around that would drag in argument-quoting problems.
// `node <path>.mjs` sidesteps both and behaves identically on every platform.
//
// Which .mjs, though, is Node's question to answer and not ours. This script
// also runs from git worktrees under .claude/worktrees/, which have no
// node_modules of their own — Node walks up to the main checkout instead — so
// assuming the package sits directly below this script is a MODULE_NOT_FOUND
// waiting to happen. Resolving lets Node walk the ancestor node_modules chain
// exactly as an `import "vitest"` from this file would.
//
// Resolution goes via `vitest/package.json` and its `bin`, not the bare
// `vitest/vitest.mjs` path: the latter is absent from vitest's `exports` map,
// so require.resolve rejects it outright with ERR_PACKAGE_PATH_NOT_EXPORTED.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveVitestEntry() {
  try {
    const require = createRequire(import.meta.url);
    const manifestPath = require.resolve("vitest/package.json");
    const { bin } = require(manifestPath);
    const entry = typeof bin === "string" ? bin : bin?.vitest;
    if (entry) return path.join(path.dirname(manifestPath), entry);
  } catch {
    // Not resolvable — most plausibly an install whose vitest predates the
    // `./package.json` export. Guess the conventional layout; the existence
    // check in main() reports it properly if the guess is wrong too.
  }
  return path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
}

const VITEST_ENTRY = resolveVitestEntry();

const SLOT_WRAPPER = path.join(homedir(), ".claude", "bin", "testslot.py");

/** Run a command inheriting stdio; returns its exit code (null if it could not start). */
function run(command, args) {
  // `command` is never user-controlled: it is either process.execPath or a name
  // from the fixed ["python", "python3"] allowlist below. The args are paths
  // derived from import.meta.url, homedir() and Node's own module resolution,
  // plus whatever `npm test` forwarded on argv. `shell` is left at its default
  // of false, so every arg goes straight to CreateProcess/execve as an array
  // element and is never parsed by a shell — forwarded argv included. This is
  // local build tooling, unreachable from HTTP or MCP request data.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) return null;
  // A signal-terminated child has a null status; report it as a failure.
  return result.status ?? 1;
}

function runVitestDirectly() {
  const code = run(process.execPath, [VITEST_ENTRY, ...vitestArgs]);
  if (code === null) {
    // Only reachable if the node binary itself will not spawn; a missing entry
    // file is caught by the existence check in main().
    console.error(`test-with-slot: could not spawn ${process.execPath}.`);
    return 1;
  }
  return code;
}

/** First python on PATH that actually runs, or null. */
function findPython() {
  for (const candidate of ["python", "python3"]) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function main() {
  // Every branch below spawns this entry, directly or through the wrapper, so
  // vet it once here. Node exits with a raw MODULE_NOT_FOUND stack when handed
  // a path that isn't there — precisely the baffling failure that sent people
  // hunting through this script in the first place.
  if (!existsSync(VITEST_ENTRY)) {
    console.error(`test-with-slot: no vitest at ${VITEST_ENTRY}. Run \`npm install\`.`);
    return 1;
  }

  if (process.env.CI) return runVitestDirectly();
  if (!existsSync(SLOT_WRAPPER)) return runVitestDirectly();

  const python = findPython();
  if (python === null) return runVitestDirectly();

  const code = run(python, [SLOT_WRAPPER, "--", process.execPath, VITEST_ENTRY, ...vitestArgs]);
  // Wrapper itself failed to start — fall back rather than fail the run.
  if (code === null) return runVitestDirectly();
  return code;
}

process.exit(main());
