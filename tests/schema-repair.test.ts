import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { initDb, openDb } from "../server/db/index.js";
import { applyMigrations, runMigrations, SchemaTooNewError, type Migration } from "../server/db/migrator.js";
import { createTestDb } from "./setup.js";

const REBUILD = "027_tasks_milestone_fk_to_milestones";
const INDEXES = "028_restore_missing_indexes";
const TS = "2026-09-29T00:00:00.000Z";

function recorded(db: Database.Database, name: string): boolean {
  return db.prepare("SELECT 1 FROM _migrations WHERE name = ?").get(name) !== undefined;
}

function foreignKeysOn(db: Database.Database): boolean {
  return db.pragma("foreign_keys", { simple: true }) === 1;
}

/** Two agents whose normalised names collide, which the unique index on that column forbids. */
function addDuplicateAgents(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT INTO agents (id, name, name_normalized, registered_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run("a1", "Claude Code", "claude code", TS, TS);
  insert.run("a2", "claude-code", "claude code", TS, TS);
}

/** Every explicitly created index, as "name: normalised DDL". */
function indexDdl(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all() as { name: string; sql: string }[]
  )
    .map((r) => `${r.name}: ${r.sql.replace(/\s+/g, " ")}`)
    .sort((a, b) => a.localeCompare(b, "en"));
}

function dropAllIndexes(db: Database.Database): void {
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const name of names) db.exec(`DROP INDEX "${name}"`);
}

/**
 * A database migrated to 026 whose tasks table still carries the foreign key
 * from milestone_id to sprints that `ALTER TABLE tasks RENAME COLUMN sprint_id
 * TO milestone_id` (002) left on databases that predate milestones, without
 * the five tasks indexes (as the old post-migration rebuild left it), and with
 * 027 and 028 pending. Data: a parent and a child task, the child with every
 * column filled; a task whose milestone_id names a sprint that never became a
 * milestone; and one activity row that already points at a missing task.
 */
function staleFkDb(options: { extraColumn?: boolean; sprintsSpelled?: string } = {}): Database.Database {
  const sprints = options.sprintsSpelled ?? "sprints";
  const db = createTestDb();
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE sprints (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE tasks_legacy (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      parent_task_id TEXT REFERENCES tasks(id),
      milestone_id TEXT REFERENCES ${sprints}(id),
      assigned_agent_id TEXT REFERENCES agents(id),
      title TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      priority TEXT NOT NULL DEFAULT 'medium',
      progress INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      start_date TEXT,
      estimate INTEGER,
      task_type TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL${options.extraColumn ? ",\n      notes TEXT" : ""}
    );
    DROP TABLE tasks;
    ALTER TABLE tasks_legacy RENAME TO tasks;

    INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'project', '${TS}', '${TS}');
    INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES ('m1', 'p1', 'milestone', '${TS}', '${TS}');
    INSERT INTO sprints (id, project_id, name, created_at, updated_at) VALUES ('s-only', 'p1', 'sprint', '${TS}', '${TS}');
    INSERT INTO agents (id, name, name_normalized, registered_at, last_seen_at) VALUES ('a1', 'agent', 'agent', '${TS}', '${TS}');
    -- rowids with gaps, as deletions leave them, so a rebuild that renumbered
    -- rows could not pass by coincidence.
    INSERT INTO tasks (rowid, id, project_id, title, created_at, updated_at)
      VALUES (10, 't-parent', 'p1', 'parent', '${TS}', '${TS}');
    INSERT INTO tasks (rowid, id, project_id, parent_task_id, milestone_id, assigned_agent_id, title, description,
                       status, priority, progress, due_date, start_date, estimate, task_type, created_at, updated_at)
      VALUES (20, 't-child', 'p1', 't-parent', 'm1', 'a1', 'child', 'every column set',
              'in_progress', 'high', 40, '2026-10-01', '2026-09-01', 5, 'feature', '${TS}', '${TS}');
    INSERT INTO tasks (rowid, id, project_id, milestone_id, title, created_at, updated_at)
      VALUES (35, 't-sprint-only', 'p1', 's-only', 'from a sprint', '${TS}', '${TS}');
    INSERT INTO activity_log (id, task_id, message, timestamp) VALUES ('orphan-activity', 't-missing', 'x', '${TS}');
  `);
  db.pragma("foreign_keys = ON");
  db.prepare("DELETE FROM _migrations WHERE name IN (?, ?)").run(REBUILD, INDEXES);
  return db;
}

type TaskRow = Record<string, unknown> & { rowid: number; id: string };

function tasksWithRowids(db: Database.Database): TaskRow[] {
  return db.prepare("SELECT rowid, * FROM tasks ORDER BY id").all() as TaskRow[];
}

describe("027: the tasks table's milestone foreign key", () => {
  it("rebuilds tasks so milestone_id references milestones, keeping every row, column and rowid", () => {
    const db = staleFkDb();
    const before = tasksWithRowids(db);

    const report = runMigrations(db);

    const fks = db.pragma("foreign_key_list(tasks)") as { from: string; table: string }[];
    expect(fks.find((fk) => fk.from === "milestone_id")?.table).toBe("milestones");
    expect(fks.some((fk) => fk.table === "sprints")).toBe(false);
    // Only the pointer at a sprint that never became a milestone changes, and
    // the operator is told.
    const expected = before.map((row) => (row.id === "t-sprint-only" ? { ...row, milestone_id: null } : row));
    expect(tasksWithRowids(db)).toEqual(expected);
    expect(report.warnings).toContain(
      "027_tasks_milestone_fk_to_milestones: 1 task pointed at a sprint that never became a milestone; " +
        "that link was cleared, and the sprint is still in the sprints table"
    );
    expect(recorded(db, REBUILD)).toBe(true);
    db.close();
  });

  it("carries views and triggers that name tasks across the rebuild", () => {
    // A view naming tasks makes the rename inside the rebuild fail unless it
    // is dropped first; a trigger on tasks would go with the old table.
    const db = staleFkDb();
    db.exec(`
      CREATE VIEW open_tasks AS SELECT id, title FROM tasks WHERE status <> 'done';
      CREATE TRIGGER tasks_touch AFTER UPDATE OF title ON tasks BEGIN
        UPDATE tasks SET updated_at = '${TS}' WHERE id = NEW.id;
      END;
    `);
    const ddl = () =>
      db.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('view', 'trigger') ORDER BY name").all();
    const before = ddl();

    runMigrations(db);

    expect(ddl()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM open_tasks").get()).toEqual({ n: 3 });
    db.close();
  });

  it("does not let a broken key elsewhere stop startup when it has nothing to rebuild", () => {
    // A foreign key naming a parent column that is not unique: foreign_key_check
    // throws on any schema holding one, as a salvaged database can.
    const db = createTestDb();
    db.exec(`
      CREATE TABLE loose_parent (x TEXT);
      CREATE TABLE loose_child (x TEXT REFERENCES loose_parent(x));
    `);
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(REBUILD);

    expect(() => runMigrations(db)).not.toThrow();
    expect(recorded(db, REBUILD)).toBe(true);
    db.close();
  });

  it("says why when a broken key elsewhere means it cannot check its own rebuild", () => {
    const db = staleFkDb();
    db.exec(`
      CREATE TABLE loose_parent (x TEXT);
      CREATE TABLE loose_child (x TEXT REFERENCES loose_parent(x));
    `);

    expect(() => runMigrations(db)).toThrow(/cannot run that check on this database/);

    expect(recorded(db, REBUILD)).toBe(false);
    expect(foreignKeysOn(db)).toBe(true);
    db.close();
  });

  it("leaves foreign keys enforced and introduces no violation, while leaving an old one alone", () => {
    const db = staleFkDb();

    runMigrations(db);

    expect(foreignKeysOn(db)).toBe(true);
    // The activity row that already pointed at a missing task is still the
    // only violation: the rebuild neither fixed it by deleting data nor
    // refused to run because of it.
    expect(db.pragma("foreign_key_check")).toEqual([
      { table: "activity_log", rowid: expect.any(Number), parent: "tasks", fkid: expect.any(Number) },
    ]);
    db.close();
  });

  it("refuses, changing nothing, when tasks has a column the rebuild does not know", () => {
    const db = staleFkDb({ extraColumn: true });
    db.prepare("UPDATE tasks SET notes = 'keep me' WHERE id = 't-child'").run();

    expect(() => runMigrations(db)).toThrow(/notes/);

    expect(recorded(db, REBUILD)).toBe(false);
    expect(foreignKeysOn(db)).toBe(true);
    const notes = db.prepare("SELECT notes FROM tasks WHERE id = 't-child'").get() as { notes: string };
    expect(notes.notes).toBe("keep me");
    db.close();
  });

  it("refuses, changing nothing, when tasks is missing a column the rebuild needs", () => {
    const db = staleFkDb();
    db.exec("ALTER TABLE tasks DROP COLUMN estimate");

    // The migration's own explanation, not SQLite's "no such column" from
    // half-way through a copy.
    expect(() => runMigrations(db)).toThrow(/lacks some it needs \(estimate\)/);

    expect(recorded(db, REBUILD)).toBe(false);
    const fks = db.pragma("foreign_key_list(tasks)") as { from: string; table: string }[];
    expect(fks.find((fk) => fk.from === "milestone_id")?.table).toBe("sprints");
    db.close();
  });

  it("recognises the legacy key however the old schema capitalised sprints", () => {
    // SQLite matches table names case-insensitively and keeps the spelling a
    // REFERENCES clause was written with, so an older schema may say Sprints.
    const db = staleFkDb({ sprintsSpelled: "Sprints" });

    runMigrations(db);

    const fks = db.pragma("foreign_key_list(tasks)") as { from: string; table: string }[];
    expect(fks.find((fk) => fk.from === "milestone_id")?.table).toBe("milestones");
    db.close();
  });

  it("recreates the indexes the table had, including ones this codebase never defined", () => {
    // An operator's own index. 028 only knows the standard ones, so this one
    // survives the rebuild only if 027 carries it across itself.
    const db = staleFkDb();
    db.exec("CREATE INDEX idx_tasks_title_by_hand ON tasks(title)");

    runMigrations(db);

    const own = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_title_by_hand'")
      .get() as { sql: string } | undefined;
    expect(own?.sql).toBe("CREATE INDEX idx_tasks_title_by_hand ON tasks(title)");
    db.close();
  });

  it("does not touch a tasks table whose foreign keys are already right", () => {
    const db = createTestDb();
    const ddl = () =>
      (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tasks'").get() as { sql: string }).sql;
    const before = ddl();
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(REBUILD);

    runMigrations(db);

    expect(ddl()).toBe(before);
    expect(recorded(db, REBUILD)).toBe(true);
    db.close();
  });
});

describe("028: indexes a fresh install has", () => {
  it("restores every index to a database that has lost them all", () => {
    const expected = indexDdl(createTestDb());
    const db = createTestDb();
    dropAllIndexes(db);
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);

    runMigrations(db);

    expect(indexDdl(db)).toEqual(expected);
    db.close();
  });

  it("restores the tasks indexes the old rebuild dropped", () => {
    const db = staleFkDb();

    runMigrations(db);

    const tasksIndexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND sql IS NOT NULL").all() as {
        name: string;
      }[]
    )
      .map((r) => r.name)
      .sort((a, b) => a.localeCompare(b, "en"));
    expect(tasksIndexes).toEqual([
      "idx_tasks_assigned_agent_id",
      "idx_tasks_milestone_id",
      "idx_tasks_priority",
      "idx_tasks_project_id",
      "idx_tasks_status",
    ]);
    db.close();
  });

  it("skips a unique index whose values are no longer unique, and says so, instead of refusing to start", () => {
    const db = createTestDb();
    db.exec("DROP INDEX idx_agents_name_normalized");
    addDuplicateAgents(db);
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);

    const report = runMigrations(db);

    expect(report.warnings.some((w) => w.includes("idx_agents_name_normalized"))).toBe(true);
    expect(indexDdl(db).some((d) => d.startsWith("idx_agents_name_normalized:"))).toBe(false);
    expect(recorded(db, INDEXES)).toBe(true);
    db.close();
  });

  it("creates a skipped unique index on the first start after its duplicates are resolved", () => {
    const db = createTestDb();
    db.exec("DROP INDEX idx_agents_name_normalized");
    addDuplicateAgents(db);
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);
    expect(runMigrations(db).warnings.some((w) => w.includes("idx_agents_name_normalized"))).toBe(true);

    // Someone resolves it by hand. Nothing is pending any more, yet the next
    // start brings the index back.
    db.prepare("UPDATE agents SET name_normalized = 'claude code 2' WHERE id = 'a2'").run();
    const next = runMigrations(db);

    expect(next.applied).toEqual([]);
    expect(next.warnings).toEqual([]);
    expect(indexDdl(db).some((d) => d.startsWith("idx_agents_name_normalized:"))).toBe(true);
    db.close();
  });

  it("skips the unique external_id index the same way when cost rows share an id", () => {
    const db = createTestDb();
    db.exec("DROP INDEX idx_cost_entries_external_id");
    const insert = db.prepare(
      "INSERT INTO cost_entries (id, model, provider, created_at, source, external_id) VALUES (?, 'm', 'p', ?, 'transcript', ?)"
    );
    insert.run("c1", TS, "same-uuid");
    insert.run("c2", TS, "same-uuid");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);

    const report = runMigrations(db);

    expect(report.warnings.some((w) => w.includes("idx_cost_entries_external_id"))).toBe(true);
    expect(recorded(db, INDEXES)).toBe(true);
    db.close();
  });

  it("skips an index whose column has gone, and says which", () => {
    const db = createTestDb();
    db.exec("DROP INDEX idx_activity_log_source; ALTER TABLE activity_log DROP COLUMN source;");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);

    const report = runMigrations(db);

    expect(report.warnings).toEqual([
      "028_restore_missing_indexes: idx_activity_log_source not created: activity_log has no source column",
    ]);
    expect(recorded(db, INDEXES)).toBe(true);
    db.close();
  });

  it("still restores the rest when a table has gone, as after a corruption salvage", () => {
    const db = createTestDb();
    db.exec("DROP TABLE task_worktrees; DROP INDEX idx_tasks_status;");
    db.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);

    expect(() => runMigrations(db)).not.toThrow();

    expect(indexDdl(db).some((d) => d.startsWith("idx_tasks_status:"))).toBe(true);
    db.close();
  });
});

describe("migration warnings reaching the entry point", () => {
  it("passes each warning to openDb's onWarning, so the server and stdio MCP can log it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-dash-warnings-"));
    try {
      const dbPath = path.join(root, "vibe-dash.db");
      const setup = new Database(dbPath);
      initDb(setup, { snapshotDir: path.join(root, "snapshots") });
      setup.exec("DROP INDEX idx_agents_name_normalized");
      addDuplicateAgents(setup);
      setup.prepare("DELETE FROM _migrations WHERE name = ?").run(INDEXES);
      setup.close();

      const seen: string[] = [];
      const db = openDb(dbPath, "test", {
        snapshotDir: path.join(root, "snapshots"),
        onWarning: (w) => seen.push(w),
      });
      db.close();

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^idx_agents_name_normalized is missing: 1 value in agents\.name_normalized appears /);
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    // Two full opens of a real file, one with a snapshot: slow where disks are.
  }, 20000);
});

describe("019 on a database that already has its columns (DATA-11)", () => {
  it("runs without a duplicate-column error, so the database stays openable", () => {
    const db = createTestDb();
    db.prepare("DELETE FROM _migrations WHERE name = '019_transcript_ingestion'").run();

    expect(() => runMigrations(db)).not.toThrow();
    expect(recorded(db, "019_transcript_ingestion")).toBe(true);
    db.close();
  });
});

describe("migrations that rebuild a referenced table (foreignKeysOff)", () => {
  function parentChildDb(): Database.Database {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    db.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY, label TEXT);
      CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id));
      INSERT INTO parent VALUES ('p1', 'one');
      INSERT INTO child VALUES ('c1', 'p1');
    `);
    return db;
  }

  const rebuildParent: Migration = {
    name: "900_rebuild_parent",
    foreignKeysOff: true,
    run(db) {
      db.exec(`
        CREATE TABLE parent_new (id TEXT PRIMARY KEY, label TEXT NOT NULL DEFAULT '');
        INSERT INTO parent_new (rowid, id, label) SELECT rowid, id, COALESCE(label, '') FROM parent;
        DROP TABLE parent;
        ALTER TABLE parent_new RENAME TO parent;
      `);
    },
  };

  it("lets a migration drop and rebuild a table other rows reference, then turns enforcement back on", () => {
    const db = parentChildDb();

    applyMigrations(db, [rebuildParent]);

    expect(db.prepare("SELECT id, label FROM parent").all()).toEqual([{ id: "p1", label: "one" }]);
    expect(foreignKeysOn(db)).toBe(true);
    expect(db.pragma("foreign_key_check")).toEqual([]);
    db.close();
  });

  it("rolls the migration back when it leaves a violation that was not there before", () => {
    const db = parentChildDb();
    const loseTheParent: Migration = {
      name: "901_lose_parent",
      foreignKeysOff: true,
      run(d) {
        d.exec("DELETE FROM parent");
      },
    };

    expect(() => applyMigrations(db, [loseTheParent])).toThrow(/901_lose_parent/);

    expect(db.prepare("SELECT COUNT(*) AS n FROM parent").get()).toEqual({ n: 1 });
    expect(recorded(db, "901_lose_parent")).toBe(false);
    expect(foreignKeysOn(db)).toBe(true);
    db.close();
  });

  it("catches a new violation even when the same migration fixes an old one in the same pair of tables", () => {
    const db = parentChildDb();
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO child VALUES ('c-orphan', 'p-missing')");
    db.pragma("foreign_keys = ON");
    const trade: Migration = {
      name: "904_trade",
      foreignKeysOff: true,
      run(d) {
        d.exec("INSERT INTO parent VALUES ('p-missing', 'found'); DELETE FROM parent WHERE id = 'p1';");
      },
    };

    expect(() => applyMigrations(db, [trade])).toThrow(/904_trade/);
    expect(recorded(db, "904_trade")).toBe(false);
    db.close();
  });

  it("catches a violation that moves from one key to another on the same row", () => {
    // Two keys from one row to the same parent: fixing one and breaking the
    // other must not pass as "still one violation on that row".
    const db = parentChildDb();
    db.exec("CREATE TABLE pair (id TEXT PRIMARY KEY, a TEXT REFERENCES parent(id), b TEXT REFERENCES parent(id))");
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO pair VALUES ('row', 'gone-a', NULL)");
    db.pragma("foreign_keys = ON");
    const swap: Migration = {
      name: "905_swap",
      foreignKeysOff: true,
      run(d) {
        d.exec("UPDATE pair SET a = NULL, b = 'gone-b'");
      },
    };

    expect(() => applyMigrations(db, [swap])).toThrow(/905_swap/);
    db.close();
  });

  it("does not mistake an old violation for a new one when a rebuild reorders the table's keys", () => {
    // SQLite numbers a table's foreign keys by where they are declared, so a
    // rebuild that declares them in another order renumbers them.
    const db = parentChildDb();
    db.exec(`
      CREATE TABLE other (id TEXT PRIMARY KEY);
      CREATE TABLE two_keys (id TEXT PRIMARY KEY, p TEXT REFERENCES parent(id), o TEXT REFERENCES other(id));
    `);
    db.pragma("foreign_keys = OFF");
    db.exec("INSERT INTO two_keys VALUES ('row', 'gone', NULL)");
    db.pragma("foreign_keys = ON");
    const reorder: Migration = {
      name: "906_reorder",
      foreignKeysOff: true,
      run(d) {
        d.exec(`
          CREATE TABLE two_keys_new (id TEXT PRIMARY KEY, o TEXT REFERENCES other(id), p TEXT REFERENCES parent(id));
          INSERT INTO two_keys_new (rowid, id, o, p) SELECT rowid, id, o, p FROM two_keys;
          DROP TABLE two_keys;
          ALTER TABLE two_keys_new RENAME TO two_keys;
        `);
      },
    };

    expect(() => applyMigrations(db, [reorder])).not.toThrow();
    expect(recorded(db, "906_reorder")).toBe(true);
    db.close();
  });

  it("refuses to start such a migration inside an open transaction, where enforcement cannot be switched off", () => {
    const db = parentChildDb();
    db.exec("BEGIN");

    expect(() => applyMigrations(db, [rebuildParent])).toThrow(/transaction/);

    db.exec("ROLLBACK");
    // Not rebuilt: label is still the original nullable column.
    const label = (db.pragma("table_info(parent)") as { name: string; notnull: number }[]).find(
      (c) => c.name === "label"
    );
    expect(label?.notnull).toBe(0);
    db.close();
  });

  it("judges a newer database against the list it was given, not the build's own", () => {
    // 001_initial_schema is in this build's list but not in the one passed
    // in, so only a guard reading the passed list calls it unknown.
    const db = new Database(":memory:");
    applyMigrations(db, [{ name: "903_known", run: () => undefined }]);
    db.prepare("INSERT INTO _migrations (name, run_at) VALUES ('001_initial_schema', ?)").run(TS);

    expect(() => applyMigrations(db, [{ name: "903_known", run: () => undefined }])).toThrow(SchemaTooNewError);
    db.close();
  });

  it("reports a migration's warnings, naming the migration", () => {
    const db = new Database(":memory:");
    const warns: Migration = { name: "902_warns", run: () => ["something to look at"] };

    const report = applyMigrations(db, [warns]);

    expect(report.warnings).toEqual(["902_warns: something to look at"]);
    db.close();
  });
});
