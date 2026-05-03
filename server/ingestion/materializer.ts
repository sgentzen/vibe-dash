import type Database from "better-sqlite3";
import {
  getUnprocessedEvents,
  markEventProcessed,
  getIngestionSourceById,
} from "../db/ingestion.js";
import { touchAgent, logCost, logActivity } from "../db/index.js";
import { broadcast } from "../websocket.js";
import { normalize } from "./normalizer.js";
import type { IngestionSourceKind } from "../db/ingestion.js";
import { logger } from "../logger.js";

let _timer: ReturnType<typeof setInterval> | null = null;

export function startMaterializer(db: Database.Database, intervalMs = 5000): void {
  if (_timer) return;
  _timer = setInterval(() => runMaterializer(db), intervalMs);
}

export function stopMaterializer(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export function runMaterializer(db: Database.Database): void {
  const events = getUnprocessedEvents(db, 100);
  for (const event of events) {
    try {
      materializeEvent(db, event);
    } catch (err) {
      logger.warn({ err, event_id: event.id }, "materializer: failed to process event");
    }
    markEventProcessed(db, event.id);
  }
}

function materializeEvent(
  db: Database.Database,
  event: {
    id: string;
    source_id: string;
    raw_payload: string;
    normalized_kind: string;
    task_id: string | null;
    agent_id: string | null;
  }
): void {
  const source = getIngestionSourceById(db, event.source_id);
  if (!source) return;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.raw_payload) as Record<string, unknown>;
  } catch {
    return;
  }

  const normalized = normalize(source.kind as IngestionSourceKind, payload);
  if (!normalized) return;

  // Auto-register agent by name
  let agentId: string | null = event.agent_id;
  if (!agentId && normalized.agent_name) {
    const agent = touchAgent(db, normalized.agent_name);
    agentId = agent.id;
    broadcast({ type: "agent_registered", payload: agent });
  }

  const projectId = normalized.project_id ?? source.project_id ?? null;

  // Log cost for cost-bearing events
  const hasCost = (normalized.cost_usd ?? 0) > 0 || (normalized.input_tokens ?? 0) > 0;
  if (hasCost && normalized.model) {
    const costEntry = logCost(db, {
      agent_id: agentId ?? undefined,
      task_id: event.task_id ?? normalized.task_id ?? undefined,
      project_id: projectId ?? undefined,
      model: normalized.model,
      provider: normalized.provider ?? "unknown",
      input_tokens: normalized.input_tokens ?? 0,
      output_tokens: normalized.output_tokens ?? 0,
      cost_usd: normalized.cost_usd ?? 0,
    });
    broadcast({ type: "cost_logged", payload: costEntry });
  }

  // Log activity when we have a task reference
  const taskId = event.task_id ?? normalized.task_id ?? null;
  if (taskId && normalized.message) {
    const entry = logActivity(db, {
      task_id: taskId,
      agent_id: agentId,
      message: normalized.message,
    });
    broadcast({
      type: "agent_activity",
      payload: { ...entry, agent_name: normalized.agent_name ?? null, task_title: null },
    });
  }

  // Broadcast ingestion event regardless
  broadcast({
    type: "ingestion_event_received",
    payload: {
      source_id: event.source_id,
      source_kind: source.kind,
      normalized_kind: normalized.kind,
      agent_name: normalized.agent_name ?? null,
      project_id: projectId,
    },
  });
}
