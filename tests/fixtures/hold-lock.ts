// Fixture for tests/owner-lock.test.ts's signal-handling coverage. Runs in
// its own process so the test can send it a *real* SIGTERM/SIGINT — the
// module-level handlers in server/db/ownerLock.ts only do anything useful
// when an actual OS signal is delivered to the process that owns the lock,
// which an in-process call can't simulate.
import { openDb } from "../../server/db/schema.js";

const dbPath = process.argv[2];
const entryPoint = process.argv[3] ?? "server";
if (!dbPath) {
  console.error("usage: hold-lock.ts <db-path> [entryPoint]");
  process.exit(2);
}

openDb(dbPath, entryPoint);
// Signals READY only after the lock file is guaranteed to exist.
console.log("READY");
// Keep the event loop alive until the test kills this process. Cleanup on
// SIGTERM/SIGINT is entirely the responsibility of ownerLock.ts's own
// module-level handlers — this fixture does nothing itself on exit.
setInterval(() => {}, 1000);
