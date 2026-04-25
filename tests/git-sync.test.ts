import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./setup.js";
import {
  createGitIntegration,
  listGitIntegrations,
  deleteGitIntegration,
  upsertLinkedItem,
  getLinkedItemByExternal,
  listLinkedItems,
  getGitIntegration,
} from "../server/db/index.js";
import { createProject } from "../server/db/index.js";

// ─── DB Layer Tests ────────────────────────────────────────────────────────────

describe("git-sync DB layer", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: "Test Project", description: null });
    projectId = project.id;
  });

  it("createGitIntegration creates and returns safe version (no token field)", () => {
    const integration = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "ghp_secret123", false
    );

    expect(integration.id).toBeTruthy();
    expect(integration.project_id).toBe(projectId);
    expect(integration.provider).toBe("github");
    expect(integration.owner).toBe("octocat");
    expect(integration.repo).toBe("hello-world");
    expect(integration.token_configured).toBe(true);
    expect(integration.auto_sync).toBe(false);
    // Token must NOT be present in safe response
    expect((integration as unknown as Record<string, unknown>).token).toBeUndefined();
  });

  it("listGitIntegrations filters by project_id", () => {
    const project2 = createProject(db, { name: "Other Project", description: null });

    createGitIntegration(db, projectId, "github", "owner1", "repo1", "tok1", false);
    createGitIntegration(db, project2.id, "github", "owner2", "repo2", "tok2", false);

    const forProject1 = listGitIntegrations(db, projectId);
    const forProject2 = listGitIntegrations(db, project2.id);
    const all = listGitIntegrations(db);

    expect(forProject1).toHaveLength(1);
    expect(forProject1[0].owner).toBe("owner1");
    expect(forProject2).toHaveLength(1);
    expect(forProject2[0].owner).toBe("owner2");
    expect(all).toHaveLength(2);
  });

  it("deleteGitIntegration removes the row", () => {
    const integration = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "tok", false
    );

    deleteGitIntegration(db, integration.id);

    const remaining = listGitIntegrations(db, projectId);
    expect(remaining).toHaveLength(0);
  });

  it("upsertLinkedItem creates a linked item", () => {
    const integration = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "tok", false
    );

    const item = upsertLinkedItem(db, {
      integration_id: integration.id,
      task_id: null,
      item_type: "issue",
      external_number: 42,
      external_id: "100042",
      external_title: "Fix the bug",
      external_state: "open",
      external_url: "https://github.com/octocat/hello-world/issues/42",
      pr_number: null,
      pr_state: null,
    });

    expect(item.id).toBeTruthy();
    expect(item.integration_id).toBe(integration.id);
    expect(item.external_number).toBe(42);
    expect(item.external_title).toBe("Fix the bug");
    expect(item.item_type).toBe("issue");
  });

  it("getLinkedItemByExternal retrieves by integration+type+number", () => {
    const integration = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "tok", false
    );

    upsertLinkedItem(db, {
      integration_id: integration.id,
      task_id: null,
      item_type: "issue",
      external_number: 99,
      external_id: "200099",
      external_title: "Another issue",
      external_state: "open",
      external_url: "https://github.com/octocat/hello-world/issues/99",
      pr_number: null,
      pr_state: null,
    });

    const found = getLinkedItemByExternal(db, integration.id, "issue", 99);
    const notFound = getLinkedItemByExternal(db, integration.id, "issue", 100);

    expect(found).toBeDefined();
    expect(found!.external_number).toBe(99);
    expect(notFound).toBeUndefined();
  });

  it("token is never present in GitIntegrationSafe response", () => {
    createGitIntegration(db, projectId, "github", "octocat", "hello-world", "super-secret-token", false);

    const integrations = listGitIntegrations(db, projectId);
    for (const i of integrations) {
      expect((i as unknown as Record<string, unknown>).token).toBeUndefined();
      expect(i.token_configured).toBe(true);
    }
  });

  it("upsertLinkedItem updates existing item instead of inserting duplicate", () => {
    const integration = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "tok", false
    );

    upsertLinkedItem(db, {
      integration_id: integration.id,
      task_id: null,
      item_type: "issue",
      external_number: 7,
      external_id: "7",
      external_title: "Original title",
      external_state: "open",
      external_url: "https://github.com/octocat/hello-world/issues/7",
      pr_number: null,
      pr_state: null,
    });

    upsertLinkedItem(db, {
      integration_id: integration.id,
      task_id: null,
      item_type: "issue",
      external_number: 7,
      external_id: "7",
      external_title: "Updated title",
      external_state: "closed",
      external_url: "https://github.com/octocat/hello-world/issues/7",
      pr_number: null,
      pr_state: null,
    });

    const items = listLinkedItems(db, integration.id);
    expect(items).toHaveLength(1);
    expect(items[0].external_title).toBe("Updated title");
    expect(items[0].external_state).toBe("closed");
  });

  it("getGitIntegration (internal) returns full record including token", () => {
    const safe = createGitIntegration(
      db, projectId, "github", "octocat", "hello-world", "my-secret-token", false
    );

    const full = getGitIntegration(db, safe.id);
    expect(full).toBeDefined();
    expect(full!.token).toBe("my-secret-token");
  });
});

// ─── Sync Service Tests (with mocked Octokit) ─────────────────────────────────

const mockIssues = [
  {
    id: 1001,
    number: 1,
    title: "First issue",
    body: "Description of first issue",
    state: "open",
    html_url: "https://github.com/owner/repo/issues/1",
    pull_request: undefined,
  },
  {
    id: 1002,
    number: 2,
    title: "Second issue",
    body: null,
    state: "open",
    html_url: "https://github.com/owner/repo/issues/2",
    pull_request: undefined,
  },
];

vi.mock("@octokit/rest", () => {
  return {
    Octokit: class MockOctokit {
      issues = {
        listForRepo: vi.fn().mockResolvedValue({ data: mockIssues }),
        update: vi.fn().mockResolvedValue({}),
      };
    },
  };
});

describe("syncGitHubIssues (mocked Octokit)", () => {
  let db: Database.Database;
  let projectId: string;

  beforeEach(() => {
    db = createTestDb();
    const project = createProject(db, { name: "Sync Test Project", description: null });
    projectId = project.id;
  });

  it("creates 2 tasks and 2 linked items for 2 mocked issues", async () => {
    const { syncGitHubIssues } = await import("../server/git-sync-service.js");

    const integration = createGitIntegration(
      db, projectId, "github", "owner", "repo", "tok-placeholder", false
    );

    const result = await syncGitHubIssues(db, integration.id);

    expect(result.issues_pulled).toBe(2);
    expect(result.issues_updated).toBe(0);
    expect(result.errors).toHaveLength(0);

    const items = listLinkedItems(db, integration.id);
    expect(items).toHaveLength(2);

    const numbers = items.map((i) => i.external_number).sort();
    expect(numbers).toEqual([1, 2]);

    // Each item should have a linked task_id
    for (const item of items) {
      expect(item.task_id).toBeTruthy();
    }
  });

  it("updates existing linked items on re-sync", async () => {
    const { syncGitHubIssues } = await import("../server/git-sync-service.js");

    const integration = createGitIntegration(
      db, projectId, "github", "owner", "repo", "tok-placeholder", false
    );

    // First sync — creates tasks
    await syncGitHubIssues(db, integration.id);

    // Second sync — should update, not create new
    const result2 = await syncGitHubIssues(db, integration.id);

    expect(result2.issues_pulled).toBe(0);
    expect(result2.issues_updated).toBe(2);

    const items = listLinkedItems(db, integration.id);
    expect(items).toHaveLength(2);
  });
});
