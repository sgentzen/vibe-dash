import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript } from "../server/ingest/transcripts/parse.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "transcripts");
const read = (name: string): string => readFileSync(path.join(FIXTURES, name), "utf8");

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
});
