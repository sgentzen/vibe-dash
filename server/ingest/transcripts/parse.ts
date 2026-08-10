import type { ParseResult, UsageRecord } from "./types.js";

// The transcript format is undocumented and can change without notice, so this
// parser is tolerant by construction: unknown fields are ignored, and any line
// it cannot use is skipped and counted rather than thrown. A format break
// therefore degrades to "no new records" plus a rising skipped count, never to
// corrupt cost data.

function asInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Extract a usage record from one parsed line, or null if the line is not one. */
function toUsageRecord(row: Record<string, unknown>): UsageRecord | null {
  if (row.type !== "assistant") return null;

  const message = row.message as Record<string, unknown> | undefined;
  const usage = message?.usage as Record<string, unknown> | undefined;
  if (!usage) return null;

  // Without a uuid there is no idempotency key, so the record could be
  // double-counted on the next scan. Refuse it rather than risk that.
  const uuid = asString(row.uuid);
  const sessionId = asString(row.sessionId);
  const timestamp = asString(row.timestamp);
  const model = asString(message?.model);
  if (!uuid || !sessionId || !timestamp || !model) return null;

  const cacheCreation = usage.cache_creation as Record<string, unknown> | undefined;

  return {
    uuid,
    sessionId,
    timestamp,
    cwd: asString(row.cwd),
    gitBranch: asString(row.gitBranch),
    model,
    speed: asString(usage.speed),
    isSidechain: row.isSidechain === true,
    inputTokens: asInt(usage.input_tokens),
    outputTokens: asInt(usage.output_tokens),
    cacheCreation5mTokens: asInt(cacheCreation?.ephemeral_5m_input_tokens),
    cacheCreation1hTokens: asInt(cacheCreation?.ephemeral_1h_input_tokens),
    cacheReadTokens: asInt(usage.cache_read_input_tokens),
  };
}

/** Parse a whole transcript body. Never throws on malformed content. */
export function parseTranscript(text: string): ParseResult {
  const records: UsageRecord[] = [];
  let skippedLines = 0;
  let lastUuid: string | null = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue; // Blank lines are not junk.

    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      skippedLines++;
      continue;
    }

    // Reject non-object JSON (null, scalars, arrays). Though JSON.parse succeeds
    // on these, they cannot carry the fields a usage record needs, so treat them
    // as structurally unusable, same as unparseable lines.
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      skippedLines++;
      continue;
    }

    const record = toUsageRecord(row);
    if (record === null) {
      // Most lines legitimately lack usage (user turns, attachments). Only
      // count a skip for assistant rows, so the counter tracks real trouble.
      if (row.type === "assistant") skippedLines++;
      continue;
    }

    records.push(record);
    lastUuid = record.uuid;
  }

  return { records, skippedLines, bytesRead: Buffer.byteLength(text, "utf8"), lastUuid };
}
