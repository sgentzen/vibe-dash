import fs from "node:fs";

// Removes the temp SQLite DB + empty Claude-home dir that playwright.config.ts
// creates for the run (see E2E_TMP_ROOT there). globalSetup/globalTeardown run
// in the same Playwright runner process that evaluates the config module, so
// the env var set there is visible here without any extra plumbing.
export default async function globalTeardown(): Promise<void> {
  const tmpRoot = process.env.E2E_TMP_ROOT;
  if (!tmpRoot) return;
  try {
    // Playwright runs globalTeardown BEFORE it stops the webServer process it
    // started (confirmed empirically: this consistently throws EPERM on
    // Windows, where a still-running process's open handle on a file blocks
    // deletion of its containing directory). So the express server here still
    // holds its better-sqlite3 file handle on the DB under tmpRoot for the
    // entire duration of this function — no amount of waiting inside it
    // reaches a moment where the file is unlocked. maxRetries/retryDelay are
    // kept small (they're a real remedy for a transient lock, e.g. on Linux
    // CI, but not for this guaranteed-until-shutdown one); the catch below is
    // what actually handles the Windows case.
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (err) {
    // Best-effort: a leftover temp dir under the OS temp root is not worth
    // failing an otherwise-green run over (it sits outside the repo, never
    // touches vibe-dash.db, and the OS reclaims temp dirs on its own). Mirrors
    // how server/index.ts treats transcript-ingestion failures as non-fatal.
    console.warn(`[e2e] could not remove temp dir ${tmpRoot}:`, err);
  }
}
