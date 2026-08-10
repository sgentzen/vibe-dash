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

const cursorOffset = (file: string): number =>
  (db.prepare(`SELECT byte_offset FROM transcript_files WHERE path = ?`).get(file) as { byte_offset: number }).byte_offset;

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

  it("re-reads correctly when a mid-write cursor is followed by a smaller rewrite (C-1)", async () => {
    // A cursor that has stopped short of the file's recorded size (because it
    // caught a write in progress) must not be trusted as a valid read
    // position against a *different*, smaller file later. `offset <= size`
    // alone cannot tell "same file, more of the same content" apart from
    // "different, unrelated content that happens to still be longer than
    // offset" — only comparing against the previously recorded size can.
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });
    const offsetAfterFirst = cursorOffset(file);

    // Simulate a large write in progress: a long unterminated fragment with
    // no newline anywhere in it, so the cursor cannot advance past a-1's line.
    appendFileSync(file, "X".repeat(500), "utf8");
    const mid = await syncTranscripts(db, { claudeHome: home });
    expect(mid.recordsIngested).toBe(0);
    const cursorAfterMid = db.prepare(`SELECT byte_offset, size FROM transcript_files WHERE path = ?`).get(file) as
      { byte_offset: number; size: number };
    expect(cursorAfterMid.byte_offset).toBe(offsetAfterFirst); // did not move
    expect(cursorAfterMid.size).toBeGreaterThan(cursorAfterMid.byte_offset); // stopped short

    // The in-progress write is abandoned. The file is rewritten smaller than
    // the recorded size (previousSize), but the new content at the old
    // byte_offset is unrelated to what used to be there — a longer cwd path
    // shifts every line boundary so nothing lines up by coincidence.
    writeFileSync(
      file,
      line("a-9", "C:/repos/demo/a/deliberately/much/longer/path/so/nothing/lines/up/by/accident"),
      "utf8"
    );
    const after = await syncTranscripts(db, { claudeHome: home });

    expect(after.recordsIngested).toBe(1);
    const row = db.prepare(`SELECT * FROM cost_entries WHERE external_id = 'a-9'`).get();
    expect(row).toBeDefined();
  });

  it("does not lose a record torn mid-object during a scan", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });
    const offsetAfterFirst = cursorOffset(file);

    // A genuine torn write: cut inside the JSON body, not just off the
    // trailing newline. This is syntactically invalid JSON, unlike stripping
    // only the terminator, which still parses.
    const full = Buffer.from(line("a-2", "C:/repos/demo"), "utf8");
    const torn = full.subarray(0, full.length - 15);
    appendFileSync(file, torn);

    const mid = await syncTranscripts(db, { claudeHome: home });
    expect(mid.recordsIngested).toBe(0);
    expect(cursorOffset(file)).toBe(offsetAfterFirst); // cursor must not have moved

    // The writer finishes the line.
    appendFileSync(file, full.subarray(full.length - 15));
    const after = await syncTranscripts(db, { claudeHome: home });

    expect(after.recordsIngested).toBe(1);
    expect(rowCount()).toBe(2);
    expect(cursorOffset(file)).toBe(offsetAfterFirst + full.length);
  });

  it("does not lose a record torn inside a multi-byte character", async () => {
    const file = writeTranscript("proj/a.jsonl", line("a-1", "C:/repos/demo"));
    await syncTranscripts(db, { claudeHome: home });
    const offsetAfterFirst = cursorOffset(file);

    // Cut inside the UTF-8 bytes of an emoji (a 4-byte code point), not on a
    // character boundary. A string-index approach to finding the newline
    // could mis-locate the boundary here; a byte-index approach cannot.
    const full = Buffer.from(line("a-2", "C:/repos/demo-\uD83D\uDE42"), "utf8"); // 🙂
    const emojiStart = full.indexOf(Buffer.from("\uD83D\uDE42", "utf8"));
    expect(emojiStart).toBeGreaterThan(-1);
    const torn = full.subarray(0, emojiStart + 2); // 2 of the emoji's 4 bytes
    appendFileSync(file, torn);

    const mid = await syncTranscripts(db, { claudeHome: home });
    expect(mid.recordsIngested).toBe(0);
    expect(cursorOffset(file)).toBe(offsetAfterFirst); // cursor must not have moved

    appendFileSync(file, full.subarray(emojiStart + 2));
    const after = await syncTranscripts(db, { claudeHome: home });

    expect(after.recordsIngested).toBe(1);
    expect(rowCount()).toBe(2);
    expect(cursorOffset(file)).toBe(offsetAfterFirst + full.length);
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
