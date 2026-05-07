import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  registerDetector,
  runDetectors,
  listDetectors,
  _resetRegistry,
} from "../server/detectors/index.js";
import type { Detector, Match, DetectorContext } from "../server/detectors/index.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  _resetRegistry();
});

afterEach(() => {
  _resetRegistry();
  delete process.env.VIBE_SUPPRESS_DETECTORS;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDetector(overrides: Partial<Detector> = {}): Detector {
  return {
    id: "test-detector",
    category: "test",
    defaultThreshold: 0,
    predicate: (_ctx: DetectorContext): Match[] => [
      { entityId: "entity-1", entityType: "task", label: "Test match" },
    ],
    score: (_match: Match, _ctx: DetectorContext): number => 50,
    ...overrides,
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

describe("registerDetector", () => {
  it("adds a detector to the registry", () => {
    registerDetector(makeDetector());
    expect(listDetectors()).toHaveLength(1);
  });

  it("throws on duplicate id", () => {
    registerDetector(makeDetector());
    expect(() => registerDetector(makeDetector())).toThrow("already registered");
  });

  it("allows different ids", () => {
    registerDetector(makeDetector({ id: "d1" }));
    registerDetector(makeDetector({ id: "d2" }));
    expect(listDetectors()).toHaveLength(2);
  });
});

// ─── Runner — basic ───────────────────────────────────────────────────────────

describe("runDetectors — basic", () => {
  it("returns empty array when no detectors registered", () => {
    expect(runDetectors(db)).toEqual([]);
  });

  it("returns scored match from registered detector", () => {
    registerDetector(makeDetector());
    const results = runDetectors(db);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      detectorId: "test-detector",
      category: "test",
      score: 50,
      entityId: "entity-1",
      entityType: "task",
      label: "Test match",
    });
  });

  it("sorts matches by score descending", () => {
    registerDetector(
      makeDetector({
        id: "low",
        predicate: () => [{ entityId: "e1", entityType: "task", label: "Low" }],
        score: () => 20,
      })
    );
    registerDetector(
      makeDetector({
        id: "high",
        predicate: () => [{ entityId: "e2", entityType: "task", label: "High" }],
        score: () => 80,
      })
    );
    const results = runDetectors(db);
    expect(results[0].score).toBe(80);
    expect(results[1].score).toBe(20);
  });

  it("returns multiple matches from one detector", () => {
    registerDetector(
      makeDetector({
        predicate: () => [
          { entityId: "e1", entityType: "task", label: "A" },
          { entityId: "e2", entityType: "blocker", label: "B" },
        ],
      })
    );
    expect(runDetectors(db)).toHaveLength(2);
  });
});

// ─── Runner — threshold ───────────────────────────────────────────────────────

describe("runDetectors — threshold filtering", () => {
  it("filters matches below defaultThreshold", () => {
    registerDetector(makeDetector({ defaultThreshold: 60, score: () => 50 }));
    expect(runDetectors(db)).toHaveLength(0);
  });

  it("includes match equal to defaultThreshold", () => {
    registerDetector(makeDetector({ defaultThreshold: 50, score: () => 50 }));
    expect(runDetectors(db)).toHaveLength(1);
  });

  it("minScore option overrides defaultThreshold", () => {
    registerDetector(makeDetector({ defaultThreshold: 0, score: () => 30 }));
    expect(runDetectors(db, { minScore: 50 })).toHaveLength(0);
    expect(runDetectors(db, { minScore: 30 })).toHaveLength(1);
  });

  it("clamps score to 0-100", () => {
    registerDetector(makeDetector({ score: () => 150 }));
    const results = runDetectors(db);
    expect(results[0].score).toBe(100);
  });

  it("clamps negative score to 0", () => {
    registerDetector(makeDetector({ score: () => -10 }));
    const results = runDetectors(db);
    expect(results[0].score).toBe(0);
  });
});

// ─── Runner — detectorId filter ───────────────────────────────────────────────

describe("runDetectors — detectorId filter", () => {
  it("runs only the specified detector", () => {
    registerDetector(makeDetector({ id: "d1" }));
    registerDetector(
      makeDetector({
        id: "d2",
        predicate: () => [{ entityId: "e2", entityType: "agent", label: "Agent match" }],
        score: () => 70,
      })
    );
    const results = runDetectors(db, { detectorId: "d2" });
    expect(results).toHaveLength(1);
    expect(results[0].detectorId).toBe("d2");
  });

  it("returns empty array for unknown detectorId", () => {
    registerDetector(makeDetector());
    expect(runDetectors(db, { detectorId: "nonexistent" })).toHaveLength(0);
  });
});

// ─── Runner — suppression ─────────────────────────────────────────────────────

describe("runDetectors — env suppression", () => {
  it("suppresses detector listed in VIBE_SUPPRESS_DETECTORS", () => {
    process.env.VIBE_SUPPRESS_DETECTORS = "test-detector";
    registerDetector(makeDetector());
    expect(runDetectors(db)).toHaveLength(0);
  });

  it("suppresses only the named detector", () => {
    process.env.VIBE_SUPPRESS_DETECTORS = "d1";
    registerDetector(makeDetector({ id: "d1" }));
    registerDetector(makeDetector({ id: "d2" }));
    const results = runDetectors(db);
    expect(results).toHaveLength(1);
    expect(results[0].detectorId).toBe("d2");
  });

  it("handles multiple suppressed ids", () => {
    process.env.VIBE_SUPPRESS_DETECTORS = "d1,d2";
    registerDetector(makeDetector({ id: "d1" }));
    registerDetector(makeDetector({ id: "d2" }));
    registerDetector(makeDetector({ id: "d3" }));
    const results = runDetectors(db);
    expect(results).toHaveLength(1);
    expect(results[0].detectorId).toBe("d3");
  });
});

// ─── Runner — error isolation ─────────────────────────────────────────────────

describe("runDetectors — error isolation", () => {
  it("skips a detector whose predicate throws", () => {
    registerDetector(
      makeDetector({
        id: "broken",
        predicate: () => { throw new Error("predicate exploded"); },
      })
    );
    registerDetector(makeDetector({ id: "ok" }));
    const results = runDetectors(db);
    expect(results).toHaveLength(1);
    expect(results[0].detectorId).toBe("ok");
  });

  it("skips a match whose score function throws", () => {
    registerDetector(
      makeDetector({
        id: "bad-score",
        score: () => { throw new Error("score exploded"); },
      })
    );
    registerDetector(makeDetector({ id: "ok" }));
    const results = runDetectors(db);
    expect(results).toHaveLength(1);
    expect(results[0].detectorId).toBe("ok");
  });
});

// ─── Match shape ──────────────────────────────────────────────────────────────

describe("ScoredMatch shape", () => {
  it("includes optional detail field when present", () => {
    registerDetector(
      makeDetector({
        predicate: () => [
          { entityId: "e1", entityType: "blocker", label: "Stale blocker", detail: "48h old" },
        ],
      })
    );
    const results = runDetectors(db);
    expect(results[0].detail).toBe("48h old");
  });

  it("detail is undefined when not set", () => {
    registerDetector(makeDetector());
    const results = runDetectors(db);
    expect(results[0].detail).toBeUndefined();
  });
});
