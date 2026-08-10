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
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VITEST_ENTRY = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");

const SLOT_WRAPPER = path.join(homedir(), ".claude", "bin", "testslot.py");

/** Run a command inheriting stdio; returns its exit code (null if it could not start). */
function run(command, args) {
  // `command` is never user-controlled: it is either process.execPath or a name
  // from the fixed ["python", "python3"] allowlist below. Args are equally
  // fixed — paths derived from import.meta.url and homedir(), plus the literal
  // flags in package.json's scripts. `shell` is left at its default of false,
  // so args go straight to CreateProcess/execve as an array and are never
  // parsed by a shell. This is local build tooling, unreachable from HTTP or
  // MCP request data.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) return null;
  // A signal-terminated child has a null status; report it as a failure.
  return result.status ?? 1;
}

function runVitestDirectly() {
  const code = run(process.execPath, [VITEST_ENTRY, ...vitestArgs]);
  if (code === null) {
    console.error(`test-with-slot: could not start vitest at ${VITEST_ENTRY}. Is \`npm install\` done?`);
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
