import { describe, it, expect } from "vitest";
import { parseGitLogOutput } from "../server/ingestion/gitLog.js";

describe("parseGitLogOutput", () => {
  it("parses NUL-delimited git log output", () => {
    const NUL = "\x00";
    const raw = [
      ["abc1234567890", "feat: add foo", "alice@example.com", "2026-05-15T10:00:00+00:00"].join(NUL),
      ["def1234567890", "fix: bar", "bob@example.com", "2026-05-15T11:00:00+00:00"].join(NUL),
    ].join("\n");
    const rows = parseGitLogOutput(raw);
    expect(rows).toEqual([
      { sha: "abc1234567890", subject: "feat: add foo", author_email: "alice@example.com", authored_at: "2026-05-15T10:00:00+00:00" },
      { sha: "def1234567890", subject: "fix: bar", author_email: "bob@example.com", authored_at: "2026-05-15T11:00:00+00:00" },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("\n")).toEqual([]);
  });

  it("treats empty author_email as null", () => {
    const NUL = "\x00";
    const raw = ["abc", "subj", "", "2026-05-15T10:00:00Z"].join(NUL);
    expect(parseGitLogOutput(raw)[0].author_email).toBeNull();
  });
});
