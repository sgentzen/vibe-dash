import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDb, openReadOnlyDb, openWritableForCli, SchemaBehindError, SchemaTooNewError } from "../server/db/index.js";

describe("CLI never runs migrations (DATA-5, ARCH-11)", () => {
  let dbDir: string;
  let dbPath: string;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-cli-no-migrate-"));
    dbPath = path.join(dbDir, "vibe-dash.db");
  });

  afterEach(() => {
    fs.rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  /** Build a fully-migrated file DB, then roll back the last migration record
   * to simulate a database left behind by an older build than this one. */
  function makeBehindDb(): string {
    const setup = new Database(dbPath);
    initDb(setup);
    const rows = setup
      .prepare("SELECT name FROM _migrations ORDER BY id DESC LIMIT 1")
      .all() as { name: string }[];
    expect(rows.length).toBe(1);
    const lastMigration = rows[0].name;
    setup.prepare("DELETE FROM _migrations WHERE name = ?").run(lastMigration);
    setup.close();
    return lastMigration;
  }

  function countMigrations(): number {
    const probe = new Database(dbPath, { readonly: true });
    try {
      return (probe.prepare("SELECT COUNT(*) AS n FROM _migrations").get() as { n: number }).n;
    } finally {
      probe.close();
    }
  }

  it("openReadOnlyDb refuses a behind schema instead of migrating it", () => {
    const pending = makeBehindDb();
    const migrationsBefore = countMigrations();

    expect(() => openReadOnlyDb(dbPath)).toThrow(SchemaBehindError);
    try {
      openReadOnlyDb(dbPath);
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaBehindError);
      const e = err as SchemaBehindError;
      expect(e.pendingMigrations).toContain(pending);
      expect(e.message).toContain("start the vibe-dash server");
    }

    // Confirm nothing was actually applied — a readonly connection couldn't
    // run DDL anyway, but this proves assertSchemaCurrent() never tried.
    expect(countMigrations()).toBe(migrationsBefore);
  });

  it("openWritableForCli (add-task's path) also refuses instead of migrating", () => {
    const pending = makeBehindDb();
    const migrationsBefore = countMigrations();

    expect(() => openWritableForCli(dbPath)).toThrow(SchemaBehindError);
    try {
      openWritableForCli(dbPath);
    } catch (err) {
      expect((err as SchemaBehindError).pendingMigrations).toContain(pending);
    }

    expect(countMigrations()).toBe(migrationsBefore);
  });

  it("SchemaBehindError takes precedence over SchemaTooNewError when a DB is both behind and ahead", () => {
    // Constructed scenario (a real DB only ever goes one direction at a time,
    // but assertSchemaCurrent()'s ordering — pending checked before unknown —
    // should not be left implicit): behind on one known migration, and also
    // carrying a row this build has never heard of.
    const pending = makeBehindDb();
    const setup = new Database(dbPath);
    setup.prepare("INSERT INTO _migrations (name, run_at) VALUES (?, ?)").run(
      "999_from_the_future",
      new Date().toISOString()
    );
    setup.close();

    try {
      openReadOnlyDb(dbPath);
      expect.unreachable("openReadOnlyDb should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaBehindError);
      expect(err).not.toBeInstanceOf(SchemaTooNewError);
      expect((err as SchemaBehindError).pendingMigrations).toContain(pending);
    }
  });

  it("openReadOnlyDb succeeds without error on a fully current schema", () => {
    const setup = new Database(dbPath);
    initDb(setup);
    setup.close();

    const db = openReadOnlyDb(dbPath);
    expect(() => db.prepare("SELECT COUNT(*) FROM projects").get()).not.toThrow();
    // Readonly: an actual write must fail.
    expect(() => db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('x','x','x','x')").run())
      .toThrow();
    db.close();
  });
});
