import type Database from "better-sqlite3";
import { genId, now } from "./helpers.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitIntegration {
  id: string;
  project_id: string;
  provider: "github" | "gitlab";
  owner: string;
  repo: string;
  token: string;
  auto_sync: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Safe version — token field replaced by token_configured flag */
export interface GitIntegrationSafe extends Omit<GitIntegration, "token"> {
  token_configured: boolean;
}

export interface GitLinkedItem {
  id: string;
  integration_id: string;
  task_id: string | null;
  item_type: "issue" | "pr";
  external_number: number;
  external_id: string;
  external_title: string;
  external_state: string;
  external_url: string;
  pr_number: number | null;
  pr_state: string | null;
  synced_at: string;
}

// ─── Row parsers ──────────────────────────────────────────────────────────────

function parseIntegrationRow(row: Record<string, unknown>): GitIntegration {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    provider: row.provider as "github" | "gitlab",
    owner: row.owner as string,
    repo: row.repo as string,
    token: row.token as string,
    auto_sync: Boolean(row.auto_sync),
    last_synced_at: (row.last_synced_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function parseLinkedItemRow(row: Record<string, unknown>): GitLinkedItem {
  return {
    id: row.id as string,
    integration_id: row.integration_id as string,
    task_id: (row.task_id as string) ?? null,
    item_type: row.item_type as "issue" | "pr",
    external_number: row.external_number as number,
    external_id: row.external_id as string,
    external_title: row.external_title as string,
    external_state: row.external_state as string,
    external_url: row.external_url as string,
    pr_number: (row.pr_number as number) ?? null,
    pr_state: (row.pr_state as string) ?? null,
    synced_at: row.synced_at as string,
  };
}

function toSafe(row: GitIntegration): GitIntegrationSafe {
  const { token: _token, ...rest } = row;
  return { ...rest, token_configured: Boolean(_token) };
}

// ─── Git Integration CRUD ─────────────────────────────────────────────────────

export function createGitIntegration(
  db: Database.Database,
  project_id: string,
  provider: "github" | "gitlab",
  owner: string,
  repo: string,
  token: string,
  auto_sync: boolean
): GitIntegrationSafe {
  const id = genId();
  const ts = now();
  db.prepare(
    "INSERT INTO git_integrations (id, project_id, provider, owner, repo, token, auto_sync, created_at, updated_at)" +
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, project_id, provider, owner, repo, token, auto_sync ? 1 : 0, ts, ts);
  const row = db.prepare("SELECT * FROM git_integrations WHERE id = ?").get(id) as Record<string, unknown>;
  return toSafe(parseIntegrationRow(row));
}

export function listGitIntegrations(
  db: Database.Database,
  project_id?: string
): GitIntegrationSafe[] {
  const rows = project_id
    ? (db.prepare("SELECT * FROM git_integrations WHERE project_id = ? ORDER BY created_at DESC").all(project_id) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM git_integrations ORDER BY created_at DESC").all() as Record<string, unknown>[]);
  return rows.map((r) => toSafe(parseIntegrationRow(r)));
}

/** Internal use only — returns full record including token */
export function getGitIntegration(
  db: Database.Database,
  id: string
): GitIntegration | undefined {
  const row = db.prepare("SELECT * FROM git_integrations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? parseIntegrationRow(row) : undefined;
}

export function deleteGitIntegration(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM git_integrations WHERE id = ?").run(id);
}

export function updateLastSynced(db: Database.Database, integration_id: string): void {
  db.prepare("UPDATE git_integrations SET last_synced_at = ?, updated_at = ? WHERE id = ?")
    .run(now(), now(), integration_id);
}

// ─── Git Linked Items CRUD ────────────────────────────────────────────────────

export function upsertLinkedItem(
  db: Database.Database,
  item: Omit<GitLinkedItem, "id" | "synced_at">
): GitLinkedItem {
  const existing = getLinkedItemByExternal(db, item.integration_id, item.item_type, item.external_number);
  const ts = now();
  if (existing) {
    db.prepare(
      "UPDATE git_linked_items SET task_id = ?, external_title = ?, external_state = ?, external_url = ?, pr_number = ?, pr_state = ?, synced_at = ? WHERE id = ?"
    ).run(
      item.task_id ?? null,
      item.external_title,
      item.external_state,
      item.external_url,
      item.pr_number ?? null,
      item.pr_state ?? null,
      ts,
      existing.id
    );
    const updated = db.prepare("SELECT * FROM git_linked_items WHERE id = ?").get(existing.id) as Record<string, unknown>;
    return parseLinkedItemRow(updated);
  }
  const id = genId();
  db.prepare(
    "INSERT INTO git_linked_items (id, integration_id, task_id, item_type, external_number, external_id, external_title, external_state, external_url, pr_number, pr_state, synced_at)" +
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    item.integration_id,
    item.task_id ?? null,
    item.item_type,
    item.external_number,
    item.external_id,
    item.external_title,
    item.external_state,
    item.external_url,
    item.pr_number ?? null,
    item.pr_state ?? null,
    ts
  );
  const row = db.prepare("SELECT * FROM git_linked_items WHERE id = ?").get(id) as Record<string, unknown>;
  return parseLinkedItemRow(row);
}

export function getLinkedItemByExternal(
  db: Database.Database,
  integration_id: string,
  item_type: "issue" | "pr",
  external_number: number
): GitLinkedItem | undefined {
  const row = db.prepare(
    "SELECT * FROM git_linked_items WHERE integration_id = ? AND item_type = ? AND external_number = ?"
  ).get(integration_id, item_type, external_number) as Record<string, unknown> | undefined;
  return row ? parseLinkedItemRow(row) : undefined;
}

export function listLinkedItems(
  db: Database.Database,
  integration_id: string
): GitLinkedItem[] {
  const rows = db.prepare(
    "SELECT * FROM git_linked_items WHERE integration_id = ? ORDER BY external_number ASC"
  ).all(integration_id) as Record<string, unknown>[];
  return rows.map(parseLinkedItemRow);
}

/** Find any linked issue for a given task_id (used for push-sync) */
export function getLinkedItemByTaskId(
  db: Database.Database,
  task_id: string
): (GitLinkedItem & { owner: string; repo: string; token: string; provider: "github" | "gitlab" }) | undefined {
  const row = db.prepare(
    "SELECT gli.*, gi.owner, gi.repo, gi.token, gi.provider FROM git_linked_items gli" +
    " JOIN git_integrations gi ON gi.id = gli.integration_id" +
    " WHERE gli.task_id = ? AND gli.item_type = 'issue'" +
    " LIMIT 1"
  ).get(task_id) as (Record<string, unknown>) | undefined;
  if (!row) return undefined;
  return {
    ...parseLinkedItemRow(row),
    owner: row.owner as string,
    repo: row.repo as string,
    token: row.token as string,
    provider: row.provider as "github" | "gitlab",
  };
}
