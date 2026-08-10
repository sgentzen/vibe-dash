import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { createProject } from "../server/db/index.js";
import { linkProjectPath } from "../server/db/projectPaths.js";
import { syncTranscripts, getIngestStatus } from "../server/ingest/transcripts/sync.js";

let db: Database.Database;
let home: string;

const line = (uuid: string, cwd: string, model = "claude-opus-5"): string =>
  JSON.stringify({
    type: "assistant", uuid, sessionId: "s-1", timestamp: "2026-08-09T10:00:00.000Z", cwd,
    message: { model, usage: { input_tokens: 1_000_000, output_tokens: 0 } },
  }) + "\n";

beforeEach(() => {
  db = createTestDb();
  home = mkdtempSync(path.join(tmpdir(), "vd-transcripts-"));
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

function writeTranscript(name: string, body: string): string {
  const file = path.join(home, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return file;
}

const rowCount = (): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`).get() as { n: number }).n;

describe("syncTranscripts", () => {
  it("ingests records and prices them", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    const result = await syncTranscripts(db, { claudeHome: home });

    expect(result.recordsIngested).toBe(1);
    const row = db.prepare(`SELECT * FROM cost_entries WHERE external_id = 'a-1'`).get() as
      { cost_usd: number; source: string; input_tokens: number; project_id: string | null };
    expect(row.source).toBe("transcript");
    expect(row.input_tokens).toBe(1_000_000);
    expect(row.cost_usd).toBeCloseTo(5, 10);
  });

  it("is idempotent: a second sync inserts nothing and changes no total", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/repos/demo"));

    const first = await syncTranscripts(db, { claudeHome: home });
    expect(first.recordsIngested).toBe(2);
    const totalAfterFirst = db.prepare(`SELECT SUM(cost_usd) AS t FROM cost_entries`).get() as { t: number };

    const second = await syncTranscripts(db, { claudeHome: home });
    expect(second.recordsIngested).toBe(0);
    expect(rowCount()).toBe(2);
    const totalAfterSecond = db.prepare(`SELECT SUM(cost_usd) AS t FROM cost_entries`).get() as { t: number };
    expect(totalAfterSecond.t).toBe(totalAfterFirst.t);
  });

  it("picks up appended records without re-reading the whole file", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });

    appendFileSync(file, line("a-2", "C:/repos/demo"), "utf8");
    const second = await syncTranscripts(db, { claudeHome: home });

    expect(second.recordsIngested).toBe(1);
    expect(rowCount()).toBe(2);
  });

  it("re-reads from zero when a file shrinks, without duplicating", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });

    // Rotated or rewritten: smaller than the recorded size.
    writeFileSync(file, line("a-1", "C:/repos/demo"), "utf8");
    const second = await syncTranscripts(db, { claudeHome: home });

    expect(second.recordsIngested).toBe(0); // a-1 already present
    expect(rowCount()).toBe(2);
  });

  it("does not lose a record that was mid-write during a scan", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });

    // Simulate catching a write in progress: append a line with no terminator.
    const partial = line("a-2", "C:/repos/demo").replace(/\n$/, "");
    appendFileSync(file, partial, "utf8");
    const mid = await syncTranscripts(db, { claudeHome: home });
    expect(mid.recordsIngested).toBe(0);

    // The writer finishes the line.
    appendFileSync(file, "\n", "utf8");
    const after = await syncTranscripts(db, { claudeHome: home });
    expect(after.recordsIngested).toBe(1);
    expect(rowCount()).toBe(2);
  });

  it("attributes to a linked project and leaves the rest unattributed", async () => {
    const project = createProject(db, { name: "demo", description: null });
    linkProjectPath(db, project.id, "C:/repos/demo");
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo") + line("a-2", "C:/elsewhere"));

    const result = await syncTranscripts(db, { claudeHome: home });
    expect(result.unattributed).toBe(1);

    const attributed = db.prepare(`SELECT project_id FROM cost_entries WHERE external_id = 'a-1'`).get() as { project_id: string | null };
    const orphan = db.prepare(`SELECT project_id FROM cost_entries WHERE external_id = 'a-2'`).get() as { project_id: string | null };
    expect(attributed.project_id).toBe(project.id);
    expect(orphan.project_id).toBeNull();
  });

  it("stores an unknown model with NULL cost rather than zero", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo", "claude-not-released-yet"));
    const result = await syncTranscripts(db, { claudeHome: home });

    expect(result.unpriced).toBe(1);
    const row = db.prepare(`SELECT cost_usd, input_tokens FROM cost_entries WHERE external_id = 'a-1'`).get() as
      { cost_usd: number | null; input_tokens: number };
    expect(row.cost_usd).toBeNull();
    expect(row.input_tokens).toBe(1_000_000); // tokens kept, so it can be repriced later
  });

  it("is a no-op when the Claude home does not exist", async () => {
    const result = await syncTranscripts(db, { claudeHome: path.join(home, "nope") });
    expect(result).toMatchObject({ filesScanned: 0, recordsIngested: 0 });
  });

  it("finds transcripts in nested directories, including subagents", async () => {
    writeTranscript("proj/subagents/x.jsonl", line("sa-1", "C:/repos/demo"));
    const result = await syncTranscripts(db, { claudeHome: home });
    expect(result.recordsIngested).toBe(1);
  });

  it("reports status counts", async () => {
    writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo", "claude-unknown-x"));
    await syncTranscripts(db, { claudeHome: home });
    expect(getIngestStatus(db)).toMatchObject({ filesTracked: 1, transcriptRows: 1, unpriced: 1, unattributed: 1 });
  });
});
