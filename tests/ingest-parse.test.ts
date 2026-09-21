import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "./setup.js";
import { createTimestampNormaliser } from "../server/db/helpers.js";
import { parseTranscript as parseWith } from "../server/ingest/transcripts/parse.js";
import type { ParseResult } from "../server/ingest/transcripts/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "transcripts");
const read = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

// The parser asks SQLite whether a timestamp is readable, so every test gets a
// real in-memory database to answer, same as the ingest itself.
let parseTranscript: (text: string) => ParseResult;
beforeEach(() => {
  const normalise = createTimestampNormaliser(createTestDb());
  parseTranscript = (text) => parseWith(text, normalise);
});

describe("parseTranscript", () => {
  it("extracts only assistant records that carry usage", () => {
    const result = parseTranscript(read("basic.jsonl"));
    expect(result.records.map((r) => r.uuid)).toEqual(["a-1", "a-2"]);
  });

  it("reads every token class, including both cache TTLs", () => {
    const [first] = parseTranscript(read("basic.jsonl")).records;
    expect(first).toMatchObject({
      uuid: "a-1",
      sessionId: "s-1",
      model: "claude-opus-5",
      gitBranch: "main",
      isSidechain: false,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 100,
      cacheCreation5mTokens: 50,
      cacheCreation1hTokens: 0,
      speed: "standard",
    });
    expect(first.cwd).toBe("C:\\Users\\sgent\\projects\\demo");
  });

  it("keeps sidechain (subagent) records, flagged", () => {
    const second = parseTranscript(read("basic.jsonl")).records[1];
    expect(second.isSidechain).toBe(true);
    expect(second.cacheCreation1hTokens).toBe(80);
  });

  it("survives junk lines and counts them", () => {
    const result = parseTranscript(read("messy.jsonl"));
    // m-1 and m-3 are valid. Skipped: unparseable line, no-usage record,
    // and the record with no uuid (nothing to deduplicate on).
    expect(result.records.map((r) => r.uuid)).toEqual(["m-1", "m-3"]);
    expect(result.skippedLines).toBe(3);
  });

  it("reports the last uuid seen, for cursor bookkeeping", () => {
    expect(parseTranscript(read("messy.jsonl")).lastUuid).toBe("m-3");
  });

  it("treats a missing cache_creation block as zero rather than throwing", () => {
    const [only] = parseTranscript(
      `{"type":"assistant","uuid":"x","sessionId":"s","timestamp":"2026-08-09T00:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1}}}`
    ).records;
    expect(only.cacheCreation5mTokens).toBe(0);
    expect(only.cacheCreation1hTokens).toBe(0);
    expect(only.cacheReadTokens).toBe(0);
  });

  it("returns an empty result for empty input", () => {
    expect(parseTranscript("")).toEqual({ records: [], skippedLines: 0, bytesRead: 0, lastUuid: null });
  });

  it("does not throw on adversarial top-level JSON and skips those lines", () => {
    // Regression test: bare null, scalars, and arrays are valid JSON but not
    // object records. The parser must skip them without throwing.
    const validRecord = `{"type":"assistant","uuid":"v-1","sessionId":"s","timestamp":"2026-08-09T00:00:00.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":1,"output_tokens":1}}}`;
    const validRecord2 = `{"type":"assistant","uuid":"v-2","sessionId":"s","timestamp":"2026-08-09T00:00:01.000Z","message":{"model":"claude-opus-5","usage":{"input_tokens":2,"output_tokens":2}}}`;

    const transcript = [validRecord, "null", "5", "true", `"str"`, "[1,2]", validRecord2].join("\n");

    expect(() => parseTranscript(transcript)).not.toThrow();

    const result = parseTranscript(transcript);
    expect(result.records.map((r) => r.uuid)).toEqual(["v-1", "v-2"]);
    expect(result.skippedLines).toBe(5); // null, 5, true, "str", [1,2]
    expect(result.lastUuid).toBe("v-2");
  });
});

/** One otherwise valid assistant usage line carrying the given timestamp. */
const withTimestamp = (uuid: string, timestamp: unknown): string =>
  JSON.stringify({
    type: "assistant", uuid, sessionId: "s", timestamp,
    message: { model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 1 } },
  });

// The timestamp is copied into cost_entries.created_at, so it is checked the
// way the read side will read it: by SQLite, through julianDaySql's whitelist,
// never by Date.parse. The two disagree in both directions, and the column is
// only ever read by SQLite.
describe("parseTranscript timestamps", () => {
  it("keeps the canonical form Claude Code writes exactly as it is", () => {
    const [only] = parseTranscript(withTimestamp("t", "2026-08-09T10:00:00.123Z")).records;
    expect(only.timestamp).toBe("2026-08-09T10:00:00.123Z");
  });

  it.each([
    ["no fraction", "2026-08-09T10:00:00Z", "2026-08-09T10:00:00.000Z"],
    ["a space for the T", "2026-08-09 10:00:00", "2026-08-09T10:00:00.000Z"],
    ["no zone, read as UTC as SQLite does", "2026-08-09T10:00:00", "2026-08-09T10:00:00.000Z"],
    ["an offset, converted to UTC", "2026-08-09T20:00:00+10:00", "2026-08-09T10:00:00.000Z"],
    ["a bare date", "2026-08-09", "2026-08-09T00:00:00.000Z"],
    ["more than millisecond precision", "2026-08-09T10:00:00.123456Z", "2026-08-09T10:00:00.123Z"],
  ])("normalises %s to canonical ISO-8601 Z", (_label, raw, canonical) => {
    const [only] = parseTranscript(withTimestamp("t", raw)).records;
    expect(only.timestamp).toBe(canonical);
  });

  it.each([
    ["free text", "not-a-date"],
    // SQLite reads these as the current instant, which would file the row
    // under whatever day it happened to be ingested.
    ["the clock word 'now'", "now"],
    ["'now' in any case", "NOW"],
    ["'now' with a trailing NUL, which julianday() still reads as the clock", "now\u0000"],
    ["the clock word 'subsec'", "subsec"],
    // SQLite reads a bare number as a Julian day and time-only text as a
    // moment on 2000-01-01: readable, but not a date any writer means.
    ["a bare Julian day number", "2451545"],
    ["time-only text", "05:00"],
    ["a valid date with trailing junk", "2026-08-09Tgarbage"],
    ["whitespace only", "   "],
    // julianday() does the arithmetic without checking the calendar, so these
    // would be stored as 2 March and 1 October: a plausible wrong date, kept
    // for good.
    ["a day the month does not have", "2026-02-30T10:00:00.000Z"],
    ["the 31st of a 30-day month", "2026-09-31"],
    // Date.parse reads this one, SQLite does not, and SQLite is the reader.
    ["an RFC 2822 date", "Sun, 09 Aug 2026 10:00:00 GMT"],
    ["an epoch number rather than a string", 1786269600000],
  ])("skips and counts a record whose timestamp is %s", (_label, raw) => {
    const valid = withTimestamp("ok", "2026-08-09T10:00:00.000Z");
    const result = parseTranscript([valid, withTimestamp("bad", raw)].join("\n"));

    expect(result.records.map((r) => r.uuid)).toEqual(["ok"]);
    expect(result.skippedLines).toBe(1);
    expect(result.lastUuid).toBe("ok");
  });
});
