import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import { getSpendToday, getSpendTodayUnpriced } from "../server/db/index.js";

let db: Database.Database;
beforeEach(() => { db = createTestDb(); });

function addCost(db: Database.Database, id: string, cost: number | null, when: string): void {
  db.prepare(
    `INSERT INTO cost_entries (id, agent_id, project_id, model, provider, input_tokens, output_tokens, cost_usd, created_at, source, external_id)
     VALUES (?, NULL, NULL, 'some-model', 'anthropic', 10, 10, ?, ?, 'transcript', ?)`
  ).run(id, cost, when, `ext-${id}`);
}

function today(): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

describe("getSpendTodayUnpriced", () => {
  it("is zero when every row today is priced", () => {
    addCost(db, "a", 5, today());
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });

  it("counts the rows today whose cost is unknown", () => {
    // These contribute nothing to getSpendToday, because SQL SUM skips NULL.
    // That is exactly why the count has to travel beside the total.
    addCost(db, "a", 5, today());
    addCost(db, "b", null, today());
    addCost(db, "c", null, today());

    expect(getSpendTodayUnpriced(db)).toBe(2);
    expect(getSpendToday(db)).toBeCloseTo(5, 10);
  });

  it("ignores unpriced rows from before today", () => {
    // The count has to describe the same window as the total it qualifies, or
    // it explains a figure the reader is not looking at.
    addCost(db, "old", null, yesterday());
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });

  it("is zero on an empty database", () => {
    expect(getSpendTodayUnpriced(db)).toBe(0);
  });
});
