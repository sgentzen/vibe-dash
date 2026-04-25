import { createHash, randomBytes } from "crypto";
import type Database from "better-sqlite3";
import { genId, now } from "./helpers.js";

export type IngestionSourceKind = "claude_code" | "cursor" | "codex" | "copilot" | "aider" | "generic";
export type IngestionEventKind = "activity" | "cost" | "tool_call" | "file_change" | "session_start" | "session_end";

export interface IngestionSource {
  id: string;
  name: string;
  kind: IngestionSourceKind;
  project_id: string | null;
  active: boolean;
  created_at: string;
  last_event_at: string | null;
}

export interface IngestionEvent {
  id: string;
  source_id: string;
  received_at: string;
  raw_payload: string;
  normalized_kind: IngestionEventKind;
  task_id: string | null;
  agent_id: string | null;
  processed: boolean;
}

export interface CreateIngestionSourceInput {
  name: string;
  kind: IngestionSourceKind;
  project_id?: string | null;
}

function parseSource(row: Record<string, unknown>): IngestionSource & { token_hash: string } {
  return {
    id: row.id as string,
    name: row.name as string,
    kind: row.kind as IngestionSourceKind,
    token_hash: row.token_hash as string,
    project_id: (row.project_id as string) ?? null,
    active: (row.active as number) === 1,
    created_at: row.created_at as string,
    last_event_at: (row.last_event_at as string) ?? null,
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function createIngestionSource(
  db: Database.Database,
  input: CreateIngestionSourceInput
): IngestionSource & { token: string } {
  const id = genId();
  const token = generateToken();
  const token_hash = hashToken(token);
  const ts = now();
  db.prepare(
    `INSERT INTO ingestion_sources (id, name, kind, token_hash, project_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, input.name, input.kind, token_hash, input.project_id ?? null, ts);
  const source = getIngestionSourceById(db, id)!;
  return { ...source, token };
}

export function listIngestionSources(db: Database.Database): IngestionSource[] {
  return (db.prepare("SELECT * FROM ingestion_sources ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(
    (r) => {
      const { token_hash: _th, ...rest } = parseSource(r);
      return rest as IngestionSource;
    }
  );
}

export function getIngestionSourceById(db: Database.Database, id: string): IngestionSource | null {
  const row = db.prepare("SELECT * FROM ingestion_sources WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const { token_hash: _th, ...rest } = parseSource(row);
  return rest as IngestionSource;
}

export function getIngestionSourceByTokenHash(
  db: Database.Database,
  token_hash: string
): (IngestionSource & { token_hash: string }) | null {
  const row = db.prepare("SELECT * FROM ingestion_sources WHERE token_hash = ? AND active = 1").get(token_hash) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return parseSource(row);
}

export function deleteIngestionSource(db: Database.Database, id: string): boolean {
  const result = db.prepare("DELETE FROM ingestion_sources WHERE id = ?").run(id);
  return result.changes > 0;
}

export function rotateIngestionToken(
  db: Database.Database,
  id: string
): (IngestionSource & { token: string }) | null {
  const existing = getIngestionSourceById(db, id);
  if (!existing) return null;
  const token = generateToken();
  const token_hash = hashToken(token);
  db.prepare("UPDATE ingestion_sources SET token_hash = ? WHERE id = ?").run(token_hash, id);
  return { ...existing, token };
}

export function touchIngestionSource(db: Database.Database, source_id: string): void {
  db.prepare("UPDATE ingestion_sources SET last_event_at = ? WHERE id = ?").run(now(), source_id);
}

export function enqueueIngestionEvent(
  db: Database.Database,
  input: {
    source_id: string;
    raw_payload: string;
    normalized_kind: IngestionEventKind;
    task_id?: string | null;
    agent_id?: string | null;
  }
): IngestionEvent {
  const id = genId();
  const ts = now();
  db.prepare(
    `INSERT INTO ingestion_events (id, source_id, received_at, raw_payload, normalized_kind, task_id, agent_id, processed)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(id, input.source_id, ts, input.raw_payload, input.normalized_kind, input.task_id ?? null, input.agent_id ?? null);
  touchIngestionSource(db, input.source_id);
  return {
    id,
    source_id: input.source_id,
    received_at: ts,
    raw_payload: input.raw_payload,
    normalized_kind: input.normalized_kind,
    task_id: input.task_id ?? null,
    agent_id: input.agent_id ?? null,
    processed: false,
  };
}

export function getUnprocessedEvents(db: Database.Database, limit = 100): IngestionEvent[] {
  return (
    db
      .prepare(
        "SELECT * FROM ingestion_events WHERE processed = 0 ORDER BY received_at ASC LIMIT ?"
      )
      .all(limit) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    source_id: r.source_id as string,
    received_at: r.received_at as string,
    raw_payload: r.raw_payload as string,
    normalized_kind: r.normalized_kind as IngestionEventKind,
    task_id: (r.task_id as string) ?? null,
    agent_id: (r.agent_id as string) ?? null,
    processed: (r.processed as number) === 1,
  }));
}

export function markEventProcessed(db: Database.Database, id: string): void {
  db.prepare("UPDATE ingestion_events SET processed = 1 WHERE id = ?").run(id);
}

export function listIngestionEvents(
  db: Database.Database,
  filter: { source_id?: string; since?: string; limit?: number }
): IngestionEvent[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.source_id) { clauses.push("source_id = ?"); params.push(filter.source_id); }
  if (filter.since) { clauses.push("received_at > ?"); params.push(filter.since); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = filter.limit ?? 200;
  return (
    db.prepare(`SELECT * FROM ingestion_events ${where} ORDER BY received_at DESC LIMIT ?`).all(...params, limit) as Record<string, unknown>[]
  ).map((r) => ({
    id: r.id as string,
    source_id: r.source_id as string,
    received_at: r.received_at as string,
    raw_payload: r.raw_payload as string,
    normalized_kind: r.normalized_kind as IngestionEventKind,
    task_id: (r.task_id as string) ?? null,
    agent_id: (r.agent_id as string) ?? null,
    processed: (r.processed as number) === 1,
  }));
}
