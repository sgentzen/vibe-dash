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
