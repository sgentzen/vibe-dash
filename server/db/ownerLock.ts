// Advisory owner lock (ARCH-1): the server and the stdio MCP process are the
// two entry points that hold a database handle open read-write for their
// entire lifetime, which is exactly the shape that produced this project's
// past corruption incidents when two of them pointed at the same file. This
// is a cooperative, best-effort lock — it cannot stop a process that ignores
// it — but it turns "two long-lived owners on one file" from silent
// corruption risk into a clear startup error naming the other process.
//
// Two mature alternatives were considered instead of hand rolling this:
//
// - `proper-lockfile`: staleness is mtime-based, refreshed by a heartbeat
//   while the holder is alive (default `stale` 10s, `update` interval 5s),
//   not the PID-liveness check this project wants. Its heartbeat does cover
//   the idle-but-alive case reasonably well, but a crashed process's lock
//   still survives for the full stale window instead of being reclaimed the
//   moment `process.kill(pid, 0)` can prove it, and a process with a blocked
//   event loop (GC pause, long sync I/O) can spuriously lose its lock even
//   though it's still alive. Neither failure mode fits "one long-lived
//   read-write owner, reclaim immediately once it's provably dead".
// - `fs-ext` (a maintained wrapper around the OS `flock(2)` syscall) is
//   actually the better primitive in kind — the OS releases the lock on
//   process death with no polling or PID inspection at all — but it requires
//   a native binding (node-gyp) for a project whose only other native
//   dependency is better-sqlite3 itself, which is a real cost to add just for
//   this.
//
// Reimplementing PID-liveness semantics on top of either would mean
// overriding most of its default behaviour, at which point the dependency
// stops paying for itself for the file below. See the PR description
// for the fuller justification (prefer-mature-oss-migrate rule).
import fs from "node:fs";
import os from "node:os";

export interface LockHolder {
  pid: number;
  entryPoint: string;
  startedAt: string;
  /**
   * Identifies the specific process instance that wrote the lock, not just
   * its PID — `<boot-id-or-hostname>:<process-start-time>`, read from
   * `/proc/<pid>/stat` on Linux. PIDs get reused: in a container that has no
   * SIGTERM handler, `docker stop` can kill the server without it ever
   * releasing the lock, and on restart a short-lived PID (e.g. an esbuild
   * child process) can be reassigned the dead server's old PID before the
   * container comes back up. Without this, `isAlive(oldPid)` would report
   * "alive" for a completely unrelated process and refuse every future
   * startup. `undefined` on platforms without `/proc` (Windows, macOS) or
   * when a lock predates this field — callers fall back to PID liveness
   * alone, matching the prior behaviour.
   */
  identity?: string;
}

/**
 * Escape hatch for a deliberate shared-DB setup (e.g. debugging two processes
 * against the same file on purpose). Defaults off; document any use.
 */
const ALLOW_SHARED_DB_ENV = "VIBE_DASH_ALLOW_SHARED_DB";

export class DbOwnershipError extends Error {
  readonly holder: LockHolder;

  constructor(dbPath: string, holder: LockHolder) {
    super(
      `Database at ${dbPath} is already open for read-write access by another vibe-dash ` +
        `process (${holder.entryPoint}, pid ${holder.pid}, started ${holder.startedAt}). ` +
        `Vibe Dash allows only one read-write owner of a database file at a time — see ` +
        `docs/MCP-SETUP.md and use the HTTP transport instead of starting a second stdio ` +
        `process against the same file. If that process is not actually running, delete ` +
        `${lockPathFor(dbPath)} and retry. To share a database deliberately (not recommended), ` +
        `set ${ALLOW_SHARED_DB_ENV}=1.`
    );
    this.name = "DbOwnershipError";
    this.holder = holder;
  }
}

function lockPathFor(dbPath: string): string {
  return `${dbPath}.owner.lock`;
}

/**
 * `process.kill(pid, 0)` sends no signal; it only probes whether the process
 * exists (and, for another user's process, whether the OS lets us find out).
 * ESRCH means no such process — the lock is stale. EPERM means the process
 * exists but is owned by someone else, which still counts as alive: we
 * cannot prove it's dead, so we must not steal its lock.
 */
function isAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

/**
 * Field 22 (`starttime`), 1-indexed per `man proc`, of `/proc/<pid>/stat`.
 * The second field (`comm`, the executable name) is parenthesised and can
 * itself contain spaces or even closing parens, so the safe way to parse
 * this file is to split on the LAST `)` and count fields from there: state
 * is the first field after it (field 3 overall), so `starttime` (field 22)
 * is 19 fields further into that remainder (0-indexed: index 19).
 */
const STARTTIME_FIELD_INDEX = 19;

function readProcStatField(pid: number, index: number): string | null {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const lastParen = raw.lastIndexOf(")");
    if (lastParen === -1) return null;
    const fields = raw.slice(lastParen + 1).trim().split(/\s+/);
    return fields[index] ?? null;
  } catch {
    return null;
  }
}

let cachedBootId: string | null | undefined;
function bootIdentity(): string {
  if (cachedBootId === undefined) {
    try {
      cachedBootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    } catch {
      cachedBootId = null;
    }
  }
  return cachedBootId ?? os.hostname();
}

/**
 * A string identifying this exact process instance, not just its PID —
 * `undefined` on any platform without `/proc` (Windows, macOS), in which
 * case every caller here falls back to PID-liveness alone.
 */
// Exported only for tests/owner-lock.test.ts's PID-reuse coverage, which
// needs to compute a real spawned process's identity to build a matching
// lock file — not part of the module's public contract otherwise.
export function getProcessIdentity(pid: number): string | undefined {
  const startTime = readProcStatField(pid, STARTTIME_FIELD_INDEX);
  if (startTime === null) return undefined;
  return `${bootIdentity()}:${startTime}`;
}

/**
 * Is `holder` still the same live process that wrote the lock? True for the
 * calling process's own PID. Otherwise requires `process.kill(pid, 0)` to
 * report the PID alive, AND — only when both the recorded lock and the
 * current holder of that PID expose a `/proc`-based identity — that the
 * identity still matches, so a PID reused by an unrelated process after the
 * original holder exited is correctly treated as stale rather than "alive".
 */
function isLiveHolder(holder: LockHolder): boolean {
  if (holder.pid === process.pid) return true;
  if (!isAlive(holder.pid)) return false;
  if (holder.identity !== undefined) {
    const currentIdentity = getProcessIdentity(holder.pid);
    if (currentIdentity !== undefined && currentIdentity !== holder.identity) return false;
  }
  return true;
}

function readHolder(lockPath: string): LockHolder | null {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<LockHolder>;
    if (typeof raw.pid !== "number" || typeof raw.entryPoint !== "string") return null;
    return {
      pid: raw.pid,
      entryPoint: raw.entryPoint,
      startedAt: raw.startedAt ?? "unknown",
      identity: typeof raw.identity === "string" ? raw.identity : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Create `lockPath` atomically holding `info`, or return false if it already
 * exists.
 *
 * A direct `writeFileSync(lockPath, ..., {flag:"wx"})` is NOT atomic end to
 * end: `wx` makes the *creation* exclusive, but the file exists (empty, or
 * partially written) for the moment between that create and the write
 * completing. A second process racing in that window gets EEXIST, reads the
 * still-empty file, fails to parse it, and — because `readHolder` treats
 * unparseable content the same as "no lock" — would conclude the lock is
 * stale and take it over out from under the first process. Two owners.
 *
 * Writing the content to a per-process temp file first and then
 * `fs.linkSync`-ing it into place sidesteps this: `link(2)` fails atomically
 * with EEXIST if the target exists, and there is no window where `lockPath`
 * exists with incomplete content — it either doesn't exist yet, or it exists
 * fully written.
 */
function tryCreateLock(lockPath: string, info: LockHolder): boolean {
  const tmpPath = `${lockPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(info), "utf8");
  try {
    fs.linkSync(tmpPath, lockPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Best effort — an orphaned temp file is harmless clutter, not a lock.
    }
  }
}

/**
 * Acquire the advisory owner lock for a read-write open of `dbPath`, or throw
 * `DbOwnershipError` naming the process that already holds it.
 *
 * Never applies to `:memory:` databases (every test in this repo uses one via
 * `createTestDb()`) or when `VIBE_DASH_ALLOW_SHARED_DB=1` is set.
 *
 * Returns a release function; call it on normal shutdown. It is also
 * registered on the `exit` event so an ordinary process exit releases the
 * lock even if the caller forgets.
 */
// How many times to retry reclaiming a lock that looks stale before giving
// up. Each attempt is a fresh live-PID check, so this only matters when
// several processes are reclaiming the same dead owner's lock at once; one
// retry is enough to let that settle rather than resorting to a blind
// overwrite.
const MAX_RECLAIM_ATTEMPTS = 3;

export function acquireOwnerLock(dbPath: string, entryPoint: string): () => void {
  if (dbPath === ":memory:") return () => {};
  if (process.env[ALLOW_SHARED_DB_ENV] === "1") return () => {};

  const lockPath = lockPathFor(dbPath);
  const info: LockHolder = {
    pid: process.pid,
    entryPoint,
    startedAt: new Date().toISOString(),
    identity: getProcessIdentity(process.pid),
  };

  let acquired = tryCreateLock(lockPath, info);
  for (let attempt = 0; !acquired && attempt < MAX_RECLAIM_ATTEMPTS; attempt++) {
    const holder = readHolder(lockPath);
    if (holder && holder.pid !== process.pid && isLiveHolder(holder)) {
      throw new DbOwnershipError(dbPath, holder);
    }
    // Stale lock (dead PID, or unreadable/corrupt lock file): take it over.
    // Losing the reclaim race to another process doing the same thing just
    // means looping again — its lock will look live on the next read.
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Already gone — fine, we'll try to create it fresh below.
    }
    acquired = tryCreateLock(lockPath, info);
  }
  if (!acquired) {
    throw new Error(
      `Could not acquire the owner lock at ${lockPath} after ${MAX_RECLAIM_ATTEMPTS} attempts — ` +
        `another process keeps reclaiming it at the same time. Retry, or delete the lock file if ` +
        `no vibe-dash process is actually running.`
    );
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    pendingReleases.delete(release);
    try {
      const current = readHolder(lockPath);
      if (current?.pid === process.pid) fs.unlinkSync(lockPath);
    } catch {
      // Best effort — a leftover lock file is recovered by the next opener's
      // stale-PID check anyway.
    }
  };
  pendingReleases.add(release);
  return release;
}

// One shared `exit` listener releasing every outstanding lock, rather than
// one `process.once("exit", ...)` per `acquireOwnerLock()` call — a real
// process only ever opens the DB once or twice (server, stdio MCP) so this
// is mostly about keeping test suites, which open and close many databases
// in one process, from accumulating listeners past Node's default warning
// threshold.
const pendingReleases = new Set<() => void>();
process.once("exit", () => {
  for (const release of [...pendingReleases]) release();
});

// `exit` alone isn't enough: `docker stop` sends SIGTERM, and this project
// has no SIGTERM/SIGINT handler at all (PROC-1, out of scope here). With no
// listener, Node's default action for both signals is to terminate
// immediately — the process never reaches the `exit` event's synchronous
// cleanup window in the way a plain crash would, so the lock file survives
// on a persistent volume with the dead PID still in it. Combined with PID
// reuse inside the container (tsx as PID 1, short-lived children reusing
// low PIDs), that stale-but-plausible-looking lock can wedge every future
// restart — the reuse guard in `isLiveHolder()` covers PID reuse itself, but
// releasing the lock on a clean shutdown is strictly better than relying on
// it.
//
// Registering a listener disables Node's default action for that signal, so
// this must restore it explicitly: release the locks, remove this listener,
// then re-deliver the signal to this same process. With no listener left,
// Node (or another listener the app itself installs later, e.g. a future
// PROC-1 graceful-shutdown handler) applies the normal behaviour — which for
// an unhandled SIGTERM/SIGINT is termination with the conventional 128+n
// exit code. This is intentionally minimal: it does not attempt the fuller
// graceful shutdown PROC-1 describes (draining requests, closing the DB
// handle, closing MCP transports).
function releaseLocksAndReraise(signal: NodeJS.Signals): void {
  for (const release of [...pendingReleases]) release();
  process.removeListener(signal, releaseLocksAndReraise);
  process.kill(process.pid, signal);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, releaseLocksAndReraise);
}
