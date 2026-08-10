import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

interface ColumnRow { name: string; notnull: number; dflt_value: string | null }

describe("migration 019_transcript_ingestion", () => {
  it("adds the source and cache-token columns to cost_entries", () => {
    const cols = db.pragma("table_info(cost_entries)") as ColumnRow[];
    const byName = new Map(cols.map((c) => [c.name, c]));

    expect(byName.has("source")).toBe(true);
    expect(byName.get("source")!.dflt_value).toBe("'mcp'");
    expect(byName.has("external_id")).toBe(true);
    expect(byName.has("cache_creation_5m_tokens")).toBe(true);
    expect(byName.has("cache_creation_1h_tokens")).toBe(true);
  });

  it("enforces uniqueness on external_id but allows many NULLs", () => {
    const insert = db.prepare(
      `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, 'claude-opus-5', 'anthropic', 1, 1, 0.1, '2026-08-09T00:00:00.000Z', ?, ?)`
    );

    // Many NULL external_ids are fine — that is every pre-existing MCP row.
    insert.run("a", "mcp", null);
    insert.run("b", "mcp", null);

    insert.run("c", "transcript", "uuid-1");
    expect(() => insert.run("d", "transcript", "uuid-1")).toThrow(/UNIQUE/i);
  });

  it("creates project_paths with a unique path", () => {
    db.prepare(`INSERT INTO projects (id, name, description, created_at, updated_at)
                VALUES ('p1', 'demo', NULL, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z')`).run();
    const insert = db.prepare(
      `INSERT INTO project_paths (id, project_id, path, created_at)
       VALUES (?, 'p1', ?, '2026-08-09T00:00:00.000Z')`
    );
    insert.run("pp1", "c:/users/sgent/projects/demo");
    expect(() => insert.run("pp2", "c:/users/sgent/projects/demo")).toThrow(/UNIQUE/i);
  });

  it("creates transcript_files keyed by path", () => {
    const cols = db.pragma("table_info(transcript_files)") as ColumnRow[];
    expect(cols.map((c) => c.name).sort()).toEqual(
      ["byte_offset", "last_uuid", "mtime", "path", "size", "updated_at"]
    );
  });
});

describe("migration 020_cost_usd_nullable", () => {
  const insert = (db: Database.Database, id: string, cost: number | null): void => {
    db.prepare(
      `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
       VALUES (?, 'claude-opus-5', 'anthropic', 10, 20, ?, '2026-08-09T00:00:00.000Z', 'transcript', ?)`
    ).run(id, cost, `ext-${id}`);
  };

  it("accepts NULL cost_usd for an unpriced record", () => {
    expect(() => insert(db, "unpriced", null)).not.toThrow();
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'unpriced'`).get() as { cost_usd: number | null };
    expect(row.cost_usd).toBeNull();
  });

  it("still stores a real cost when one is supplied", () => {
    insert(db, "priced", 1.5);
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'priced'`).get() as { cost_usd: number | null };
    expect(row.cost_usd).toBeCloseTo(1.5, 10);
  });

  it("still defaults an omitted cost to 0, so existing writers are unaffected", () => {
    db.prepare(
      `INSERT INTO cost_entries (id, model, provider, created_at)
       VALUES ('defaulted', 'claude-opus-5', 'anthropic', '2026-08-09T00:00:00.000Z')`
    ).run();
    const row = db.prepare(`SELECT cost_usd FROM cost_entries WHERE id = 'defaulted'`).get() as { cost_usd: number };
    expect(row.cost_usd).toBe(0);
  });

  it("keeps the partial unique index on external_id after the rebuild", () => {
    insert(db, "a", 1);
    // Same external_id as row "a" — the index must still reject it.
    expect(() =>
      db.prepare(
        `INSERT INTO cost_entries (id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
         VALUES ('b', 'claude-opus-5', 'anthropic', 1, 1, 1, '2026-08-09T00:00:00.000Z', 'transcript', 'ext-a')`
      ).run()
    ).toThrow(/UNIQUE/i);
  });

  it("preserves the columns migration 019 added", () => {
    const cols = (db.pragma("table_info(cost_entries)") as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "source", "external_id", "cache_creation_5m_tokens", "cache_creation_1h_tokens",
      "agent_id", "task_id", "milestone_id", "project_id",
    ]));
  });
});
