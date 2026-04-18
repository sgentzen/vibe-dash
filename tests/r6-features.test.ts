import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import {
  createWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  getMatchingWebhooks,
} from "../server/db/index.js";
import { createTestDb } from "./setup.js";

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

// ─── 5.3 Webhooks ────────────────────────────────────────────────────────────

describe("5.3 Webhooks", () => {
  it("creates and lists webhooks", () => {
    const hook = createWebhook(db, "https://example.com/hook", ["task_completed", "blocker_reported"]);
    expect(hook.url).toBe("https://example.com/hook");
    expect(hook.event_types).toEqual(["task_completed", "blocker_reported"]);
    expect(hook.active).toBe(true);

    const all = listWebhooks(db);
    expect(all).toHaveLength(1);
  });

  it("updates webhook url and event types", () => {
    const hook = createWebhook(db, "https://old.com/hook", ["task_completed"]);
    const updated = updateWebhook(db, hook.id, { url: "https://new.com/hook", event_types: ["blocker_reported"] });
    expect(updated!.url).toBe("https://new.com/hook");
    expect(updated!.event_types).toEqual(["blocker_reported"]);
  });

  it("toggles webhook active state", () => {
    const hook = createWebhook(db, "https://example.com/hook", ["task_completed"]);
    expect(hook.active).toBe(true);

    const paused = updateWebhook(db, hook.id, { active: false });
    expect(paused!.active).toBe(false);

    const resumed = updateWebhook(db, hook.id, { active: true });
    expect(resumed!.active).toBe(true);
  });

  it("deletes webhook", () => {
    const hook = createWebhook(db, "https://example.com/hook", ["task_completed"]);
    expect(deleteWebhook(db, hook.id)).toBe(true);
    expect(listWebhooks(db)).toHaveLength(0);
  });

  it("matches webhooks by event type", () => {
    createWebhook(db, "https://a.com/hook", ["task_completed", "blocker_reported"]);
    createWebhook(db, "https://b.com/hook", ["blocker_reported"]);
    createWebhook(db, "https://c.com/hook", ["task_created"]);

    const matches = getMatchingWebhooks(db, "blocker_reported");
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.url).sort()).toEqual(["https://a.com/hook", "https://b.com/hook"]);
  });

  it("excludes inactive webhooks from matching", () => {
    const hook = createWebhook(db, "https://example.com/hook", ["task_completed"]);
    updateWebhook(db, hook.id, { active: false });

    expect(getMatchingWebhooks(db, "task_completed")).toHaveLength(0);
  });

  it("returns empty for non-matching event type", () => {
    createWebhook(db, "https://example.com/hook", ["task_completed"]);
    expect(getMatchingWebhooks(db, "nonexistent_event")).toHaveLength(0);
  });

  it("handles multiple webhooks for same event", () => {
    createWebhook(db, "https://a.com", ["task_completed"]);
    createWebhook(db, "https://b.com", ["task_completed"]);
    createWebhook(db, "https://c.com", ["task_completed"]);

    expect(getMatchingWebhooks(db, "task_completed")).toHaveLength(3);
  });
});
