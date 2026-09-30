import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The migration runner snapshots a file database that already holds data
// before migrating it (server/db/snapshot.ts), by default into
// ~/.vibe-dash-backups. Tests that migrate file databases, including the
// two-process race in concurrent-migrations.test.ts, whose second process can
// find the first one's tables already there, would otherwise write into the
// developer's real backup folder. Every run gets its own folder instead,
// removed afterwards. Test workers and the processes they spawn inherit it.
export default function setup(): () => void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-test-backups-"));
  process.env.VIBE_DASH_BACKUP_DIR = dir;
  return () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
