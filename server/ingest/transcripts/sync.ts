import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { logger } from "../../logger.js";
import { discoverTranscripts, resolveClaudeHome } from "./discover.js";
import { parseTranscript } from "./parse.js";
import { priceRecord } from "./pricing.js";
import { buildAttributor } from "./attribute.js";
import type { SyncOptions, SyncResult, UsageRecord } from "./types.js";
import { excludeObservedCondition } from "../../db/costs.js";
import type { CostOverlap } from "../../../shared/types.js";

const PROVIDER = "anthropic";

interface CursorRow { size: number; byte_offset: number; mtime: string; last_uuid: string | null }

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
 *
 * Deciding where to start reading needs more than "is offset still <= size":
 * byte_offset now stops at the last complete line while size is the file's
 * true, larger size, so the two can and routinely do disagree even when
 * nothing is wrong. `size < previousSize` (rotated/truncated), `offset > size`
 * (cursor past EOF), and `size === previousSize && mtime !== previousMtime`
 * (same-size rewrite) are all cases where byte_offset cannot be trusted to
 * still name the same bytes, so each resets to 0.
 *
 * This is safe to get conservative about: idempotency is enforced by the
 * database (`external_id` plus the partial unique index plus INSERT OR
 * IGNORE), so re-reading bytes that were already ingested is always safe — at
 * worst it costs a wasted parse and a no-op insert. Do not "optimise" any of
 * these resets away in favour of trusting byte_offset more; that is exactly
 * the bug this function was rewritten to fix.
 */
function readFrom(
  filePath: string,
  offset: number,
  previousSize: number,
  previousMtime: string | null
): { text: string; size: number; mtime: string; newOffset: number } {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const mtime = stat.mtime.toISOString();

  let start: number;
  if (size < previousSize) {
    start = 0; // Rotated or truncated: the old offset no longer means anything.
  } else if (offset > size) {
    start = 0; // Cursor is past EOF for the file as it exists now.
  } else if (size === previousSize && mtime !== previousMtime) {
    start = 0; // Same size, different content: a same-size rewrite.
  } else {
    start = offset;
  }

  const handle = fs.openSync(filePath, "r");
  try {
    const length = size - start;
    if (length <= 0) return { text: "", size, mtime, newOffset: start };
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);

    // Byte index, not string index: the file is UTF-8 and a multi-byte
    // character could straddle the boundary, so the search has to happen on
    // the raw bytes before any decoding.
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      // No complete line in the new bytes yet. Nothing to parse this scan,
      // and the offset does not move — the same bytes are re-read next time.
      return { text: "", size, mtime, newOffset: start };
    }

    const text = buffer.subarray(0, lastNewline + 1).toString("utf8");
    return { text, size, mtime, newOffset: start + lastNewline + 1 };
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
 *
 * Genuinely asynchronous, and has to be: this runs at startup, and a machine
 * with a long Claude Code history has thousands of transcripts to walk. Every
 * step of the work is synchronous (fs.readSync, better-sqlite3), so without an
 * explicit yield the whole scan would run to completion in one go and the
 * server would accept connections it could not answer until it finished. The
 * yield sits between files, never inside one, so each file's transaction stays
 * a single uninterrupted unit.
 */
export async function syncTranscripts(db: Database.Database, opts: SyncOptions = {}): Promise<SyncResult> {
  const claudeHome = resolveClaudeHome(opts.claudeHome);
  const files = discoverTranscripts(claudeHome);

  const result: SyncResult = {
    filesScanned: 0, recordsIngested: 0, recordsSkipped: 0, unpriced: 0, unattributed: 0,
  };
  if (files.length === 0) return result;

  const attribute = buildAttributor(db);

  const selectCursor = db.prepare(`SELECT size, byte_offset, mtime, last_uuid FROM transcript_files WHERE path = ?`);
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
    // Hand the event loop back before each file so pending HTTP and WebSocket
    // work can run between them. setImmediate rather than a resolved promise:
    // a microtask would drain without ever letting I/O callbacks in, which is
    // no yield at all.
    await new Promise((resolve) => setImmediate(resolve));

    try {
      const cursor = selectCursor.get(filePath) as CursorRow | undefined;
      const offset = cursor?.byte_offset ?? 0;
      const previousSize = cursor?.size ?? 0;
      const previousMtime = cursor?.mtime ?? null;

      const { text, size, mtime, newOffset } = readFrom(filePath, offset, previousSize, previousMtime);
      result.filesScanned++;

      // True no-op: same size, same mtime as last scan, so nothing on disk
      // has changed. Nothing to read, nothing to persist.
      if (size === previousSize && mtime === previousMtime) continue;

      // Something changed (grew, shrank, or was rewritten) but no complete
      // line is available to parse yet — still record the new size/mtime so
      // rotation and same-size-rewrite detection stay accurate next time, but
      // leave byte_offset at newOffset (unchanged, or reset to 0 by readFrom
      // if this was a rotation/rewrite) so that content is re-read once a
      // complete line is available.
      if (text.length === 0) {
        upsertCursor.run({
          path: filePath, size, mtime, byte_offset: newOffset,
          last_uuid: cursor?.last_uuid ?? null, updated_at: new Date().toISOString(),
        });
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
        // Fall back to what was already recorded: a scan that read lines but
        // extracted no usage record (all skipped, or none carrying usage) has
        // nothing newer to offer, and writing NULL there would throw away a
        // cursor that was correct.
        last_uuid: parsed.lastUuid ?? cursor?.last_uuid ?? null,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      // One bad file must not abort the scan.
      logger.warn({ err, filePath }, "transcript file skipped");
    }
  }

  return result;
}

interface OverlapRow {
  project_id: string | null;
  project_name: string;
  date: string;
  mcp_entries: number;
  transcript_entries: number;
  mcp_agent_names: string | null;
  mcp_identities: string | null;
}

/** Counts behind GET /api/ingest/status, so skipped, unpriced and duplicated spend are all visible. */
export function getIngestStatus(db: Database.Database): {
  filesTracked: number; transcriptRows: number; unpriced: number; unattributed: number;
  overlaps: CostOverlap[];
} {
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;

  // A project and day holding both a self-report and an observation. Agents
  // already marked as observed are filtered out, because their rows no longer
  // reach any total and so are no longer a discrepancy to act on.
  //
  // GROUP_CONCAT skips NULLs, and transcript rows carry no agent_id, so the
  // name list only ever describes the mcp side. A self-report that named no
  // agent contributes to mcp_entries with no name, which is the visible form
  // of the row that cannot be excluded by marking.
  //
  // LEFT JOIN projects, not JOIN: log_cost's project id is optional, and an
  // mcp row that carries none was attached to an agent instead (an earlier
  // task's fix), so it must still be reportable here rather than dropped by
  // an inner join. GROUP BY c.project_id groups every NULL into one bucket in
  // SQLite, which is exactly the "Unattributed" grouping this needs.
  const rows = db.prepare(`
    SELECT c.project_id                                             AS project_id,
           COALESCE(p.name, 'Unattributed')                          AS project_name,
           DATE(c.created_at)                                        AS date,
           SUM(CASE WHEN c.source = 'mcp' THEN 1 ELSE 0 END)         AS mcp_entries,
           SUM(CASE WHEN c.source = 'transcript' THEN 1 ELSE 0 END)  AS transcript_entries,
           GROUP_CONCAT(DISTINCT a.name)                             AS mcp_agent_names,
           GROUP_CONCAT(DISTINCT COALESCE(a.client_name, a.name))    AS mcp_identities
      FROM cost_entries c
      LEFT JOIN projects p ON p.id = c.project_id
      LEFT JOIN agents a ON a.id = c.agent_id
     WHERE ${excludeObservedCondition("c.")}
     GROUP BY c.project_id, project_name, DATE(c.created_at)
    HAVING mcp_entries > 0 AND transcript_entries > 0
     ORDER BY date DESC, project_name
  `).all() as OverlapRow[];

  return {
    filesTracked: one(`SELECT COUNT(*) AS n FROM transcript_files`),
    transcriptRows: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript'`),
    unpriced: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND cost_usd IS NULL`),
    unattributed: one(`SELECT COUNT(*) AS n FROM cost_entries WHERE source = 'transcript' AND project_id IS NULL`),
    overlaps: rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      date: r.date,
      mcp_entries: r.mcp_entries,
      transcript_entries: r.transcript_entries,
      mcp_agent_names: r.mcp_agent_names === null ? [] : r.mcp_agent_names.split(","),
      mcp_identities: r.mcp_identities === null ? [] : r.mcp_identities.split(","),
    })),
  };
}
