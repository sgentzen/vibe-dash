import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../logger.js";
import { discoverTranscripts, resolveClaudeHome } from "./discover.js";
import { parseTranscript } from "./parse.js";
import { priceRecord } from "./pricing.js";
import { buildAttributor } from "./attribute.js";
import type { SyncOptions, SyncResult, UsageRecord } from "./types.js";

const PROVIDER = "anthropic";

interface CursorRow { size: number; byte_offset: number; last_uuid: string | null }

/**
 * Read the new tail of a file, given the recorded cursor.
 *
 * Never returns a byte past the last complete line. A transcript is written
 * one JSONL line at a time, and a scan can land while a write is still in
 * progress, so the last bytes on disk may be an unterminated line. Handing
 * that fragment to the parser and then advancing the cursor past it would
 * strand it: once the writer finishes the line, the next scan would start
 * reading after it and that record's spend would be lost for good. Waiting
 * for the trailing newline costs nothing — every complete transcript on disk
 * ends with one, so a tail without one only ever means "write in progress."
 */
function readFrom(
  filePath: string,
  offset: number
): { text: string; size: number; mtime: string; newOffset: number } {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  // A file smaller than the recorded size was rotated or rewritten, so the old
  // offset is meaningless. Re-read from zero. Idempotency makes that safe.
  const start = offset <= size ? offset : 0;

  const handle = fs.openSync(filePath, "r");
  try {
    const length = size - start;
    if (length <= 0) return { text: "", size, mtime: stat.mtime.toISOString(), newOffset: start };
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);

    // Byte index, not string index: the file is UTF-8 and a multi-byte
    // character could straddle the boundary, so the search has to happen on
    // the raw bytes before any decoding.
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      // No complete line in the new bytes yet. Nothing to parse this scan,
      // and the offset does not move — the same bytes are re-read next time.
      return { text: "", size, mtime: stat.mtime.toISOString(), newOffset: start };
    }

    const text = buffer.subarray(0, lastNewline + 1).toString("utf8");
    return { text, size, mtime: stat.mtime.toISOString(), newOffset: start + lastNewline + 1 };
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Read Claude Code transcripts and record their spend.
 *
 * Safe to call repeatedly: `external_id` carries the transcript record's uuid
 * and is protected by a partial unique index, so INSERT OR IGNORE makes a
 * re-scan a no-op. That guarantee lives in the database rather than in this
 * function, because money that can be double-counted by one logic bug is not
 * trustworthy money.
 *
 * Invariant: the persisted `byte_offset` never advances past the last
 * complete (newline-terminated) line. A scan that catches a transcript
 * mid-write leaves the trailing partial line unread and the cursor pointing
 * at its start, so the next scan re-reads it once the writer finishes it,
 * rather than skipping it forever.
 */
export async function syncTranscripts(db: Database.Database, opts: SyncOptions = {}): Promise<SyncResult> {
  const claudeHome = resolveClaudeHome(opts.claudeHome);
  const files = discoverTranscripts(claudeHome);

  const result: SyncResult = {
    filesScanned: 0, recordsIngested: 0, recordsSkipped: 0, unpriced: 0, unattributed: 0,
  };
  if (files.length === 0) return result;

  const attribute = buildAttributor(db);

  const selectCursor = db.prepare(`SELECT size, byte_offset, last_uuid FROM transcript_files WHERE path = ?`);
  const upsertCursor = db.prepare(`
    INSERT INTO transcript_files (path, size, mtime, byte_offset, last_uuid, updated_at)
    VALUES (@path, @size, @mtime, @byte_offset, @last_uuid, @updated_at)
    ON CONFLICT(path) DO UPDATE SET
      size = @size, mtime = @mtime, byte_offset = @byte_offset,
      last_uuid = @last_uuid, updated_at = @updated_at
  `);
  const insertCost = db.prepare(`
    INSERT OR IGNORE INTO cost_entries
      (id, agent_id, task_id, milestone_id, project_id, model, provider,
       input_tokens, output_tokens, cost_usd, created_at,
       source, external_id, cache_creation_5m_tokens, cache_creation_1h_tokens)
    VALUES
      (@id, NULL, NULL, NULL, @project_id, @model, @provider,
       @input_tokens, @output_tokens, @cost_usd, @created_at,
       'transcript', @external_id, @cache_5m, @cache_1h)
  `);

  // `filePath` is not used inside the transaction body — dropped from the
  // signature so it does not trip the unused-parameter lint rule.
  const ingestFile = db.transaction((records: UsageRecord[]) => {
    let ingested = 0, unpriced = 0, unattributed = 0;
    for (const record of records) {
      const cost = priceRecord(record);
      const projectId = attribute(record.cwd);
      const changes = insertCost.run({
        id: randomUUID(),
        project_id: projectId,
        model: record.model,
        provider: PROVIDER,
        input_tokens: record.inputTokens,
        output_tokens: record.outputTokens,
        cost_usd: cost,
        created_at: record.timestamp,
        external_id: record.uuid,
        cache_5m: record.cacheCreation5mTokens,
        cache_1h: record.cacheCreation1hTokens,
      }).changes;

      if (changes > 0) {
        ingested++;
        if (cost === null) unpriced++;
        if (projectId === null) unattributed++;
      }
    }
    return { ingested, unpriced, unattributed };
  });

  for (const filePath of files) {
    try {
      const cursor = selectCursor.get(filePath) as CursorRow | undefined;
      const offset = cursor?.byte_offset ?? 0;
      const previousSize = cursor?.size ?? 0;

      const { text, size, mtime, newOffset } = readFrom(filePath, offset);
      result.filesScanned++;

      // No complete new line this scan (either truly nothing new, or a
      // trailing partial line caught mid-write). Either way there is nothing
      // to parse, so byte_offset never moves here.
      if (text.length === 0) {
        // The file still grew or shrank even though no full line was ready —
        // record the new size so shrink detection stays accurate next time,
        // but leave byte_offset where it is so the partial line is re-read
        // once it is complete.
        if (size !== previousSize) {
          upsertCursor.run({
            path: filePath, size, mtime, byte_offset: newOffset,
            last_uuid: cursor?.last_uuid ?? null, updated_at: new Date().toISOString(),
          });
        }
        continue;
      }

      const parsed = parseTranscript(text);
      result.recordsSkipped += parsed.skippedLines;

      const counts = ingestFile(parsed.records);
      result.recordsIngested += counts.ingested;
      result.unpriced += counts.unpriced;
      result.unattributed += counts.unattributed;

      upsertCursor.run({
        path: filePath, size, mtime, byte_offset: newOffset,
        last_uuid: parsed.lastUuid, updated_at: new Date().toISOString(),
      });
    } catch (err) {
      // One bad file must not abort the scan.
      logger.warn({ err, filePath }, "transcript file skipped");
    }
  }

  return result;
}

/** Counts behind GET /api/ingest/status, so skipped and unpriced are visible. */
export function getIngestStatus(db: Database.Database): {
  filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number;
} {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    filesTracked: one(`SELECT COUNT(*) AS n FROM transcript_files`),
    transcriptRows: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`),
    unpriced: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND cost_usd IS NULL`),
    unattributed: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND project_id IS NULL`),
  };
}
