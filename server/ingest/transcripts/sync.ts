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

interface CursorRow { size: number; byte_offset: number }

/** Read the new tail of a file, given the recorded cursor. */
function readFrom(filePath: string, offset: number): { text: string; size: number; mtime: string } {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  // A file smaller than the recorded size was rotated or rewritten, so the old
  // offset is meaningless. Re-read from zero. Idempotency makes that safe.
  const start = offset <= size ? offset : 0;

  const handle = fs.openSync(filePath, "r");
  try {
    const length = size - start;
    if (length <= 0) return { text: "", size, mtime: stat.mtime.toISOString() };
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return { text: buffer.toString("utf8"), size, mtime: stat.mtime.toISOString() };
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
 */
export async function syncTranscripts(db: Database.Database, opts: SyncOptions = {}): Promise<SyncResult> {
  const claudeHome = resolveClaudeHome(opts.claudeHome);
  const files = discoverTranscripts(claudeHome);

  const result: SyncResult = {
    filesScanned: 0, recordsIngested: 0, recordsSkipped: 0, unpriced: 0, unattributed: 0,
  };
  if (files.length === 0) return result;

  const attribute = buildAttributor(db);

  const selectCursor = db.prepare(`SELECT size, byte_offset FROM transcript_files WHERE path = ?`);
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

      const { text, size, mtime } = readFrom(filePath, offset);
      result.filesScanned++;

      // Nothing new and the file has not shrunk: skip without parsing.
      if (text.length === 0 && size === previousSize) continue;

      const parsed = parseTranscript(text);
      result.recordsSkipped += parsed.skippedLines;

      const counts = ingestFile(parsed.records);
      result.recordsIngested += counts.ingested;
      result.unpriced += counts.unpriced;
      result.unattributed += counts.unattributed;

      upsertCursor.run({
        path: filePath, size, mtime, byte_offset: size,
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
