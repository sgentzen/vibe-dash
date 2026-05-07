import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";

// ── Mock @anthropic-ai/sdk before importing intelligence ────────────────────
const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "Mocked AI response" }],
});

vi.mock("@anthropic-ai/sdk", () => {
  // Must use function() so `new MockAnthropic()` works
  function MockAnthropic() {
    return { messages: { create: mockCreate } };
  }
  return { default: MockAnthropic, Anthropic: MockAnthropic };
});

import {
  isAiConfigured,
  generateDigest,
  queryNaturalLanguage,
  getDigestAnomalies,
  shouldSendDigest,
} from "../server/intelligence.js";

describe("intelligence module", () => {
  let db: Database.Database;
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    db = createTestDb();
    // Ensure no key by default
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    vi.clearAllMocks();
  });

  // ── isAiConfigured ──────────────────────────────────────────────────────

  it("isAiConfigured returns false when ANTHROPIC_API_KEY is not set", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("isAiConfigured returns true when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    expect(isAiConfigured()).toBe(true);
  });

  // ── generateDigest ──────────────────────────────────────────────────────

  it("generateDigest throws when no API key configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateDigest(db, "daily")).rejects.toThrow(
      "ANTHROPIC_API_KEY not configured"
    );
  });

  it("generateDigest returns a string when API key is configured", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    const result = await generateDigest(db, "daily");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-4-5-20251001",
    }));
  });

  it("generateDigest accepts weekly period", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    const result = await generateDigest(db, "weekly");
    expect(typeof result).toBe("string");
  });

  it("generateDigest accepts optional projectId", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    const result = await generateDigest(db, "daily", "some-project-id");
    expect(typeof result).toBe("string");
  });

  // ── queryNaturalLanguage ────────────────────────────────────────────────

  it("queryNaturalLanguage throws when no API key configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(queryNaturalLanguage(db, "What changed this week?")).rejects.toThrow(
      "ANTHROPIC_API_KEY not configured"
    );
  });

  it("queryNaturalLanguage returns a string answer", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    const result = await queryNaturalLanguage(db, "Which tasks are blocked?");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("queryNaturalLanguage accepts optional projectId", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    const result = await queryNaturalLanguage(
      db,
      "What did Claude work on yesterday?",
      "some-project-id"
    );
    expect(typeof result).toBe("string");
  });

  // ── getDigestAnomalies ──────────────────────────────────────────────────
  // Runs detectors against the DB — empty DB means no anomalies

  it("getDigestAnomalies returns an array", () => {
    const result = getDigestAnomalies(db);
    expect(Array.isArray(result)).toBe(true);
  });

  it("getDigestAnomalies returns empty array for empty DB", () => {
    const result = getDigestAnomalies(db);
    expect(result).toHaveLength(0);
  });

  it("getDigestAnomalies respects limit parameter", () => {
    const result = getDigestAnomalies(db, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("getDigestAnomalies result items have required fields", () => {
    const result = getDigestAnomalies(db);
    for (const item of result) {
      expect(typeof item.detectorId).toBe("string");
      expect(typeof item.category).toBe("string");
      expect(typeof item.label).toBe("string");
      expect(typeof item.score).toBe("number");
    }
  });

  // ── shouldSendDigest ────────────────────────────────────────────────────

  it("shouldSendDigest returns false for empty DB (no anomalies)", () => {
    expect(shouldSendDigest(db)).toBe(false);
  });

  it("shouldSendDigest returns boolean", () => {
    const result = shouldSendDigest(db, 50);
    expect(typeof result).toBe("boolean");
  });
});

// ── REST endpoint handler tests ─────────────────────────────────────────────
// Test the route logic directly without an HTTP server

describe("intelligence REST endpoint logic (503 when no API key)", () => {
  let db: Database.Database;
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    db = createTestDb();
    delete process.env.ANTHROPIC_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("isAiConfigured is false without key — simulates 503 condition", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiConfigured()).toBe(false);
  });

  it("isAiConfigured is true with key — simulates 200 condition", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-placeholder";
    expect(isAiConfigured()).toBe(true);
  });

  it("generateDigest throws ANTHROPIC_API_KEY error — maps to 503 in route", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await generateDigest(db, "daily").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("ANTHROPIC_API_KEY not configured");
  });

  it("queryNaturalLanguage throws ANTHROPIC_API_KEY error — maps to 503 in route", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await queryNaturalLanguage(db, "test").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("ANTHROPIC_API_KEY not configured");
  });
});
