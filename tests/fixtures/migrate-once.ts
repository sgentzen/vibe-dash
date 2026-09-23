// Fixture for tests/concurrent-migrations.test.ts. Runs in its own process so
// two instances can genuinely race to migrate the same on-disk database file
// (DATA-15) — something a single-threaded in-process test cannot simulate.
import Database from "better-sqlite3";
import { initDb } from "../../server/db/schema.js";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("usage: migrate-once.ts <db-path>");
  process.exit(2);
}

try {
  const db = new Database(dbPath);
  initDb(db);
  db.close();
  console.log("OK");
} catch (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
}
