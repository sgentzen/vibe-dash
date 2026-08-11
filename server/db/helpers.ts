import { randomUUID } from "node:crypto";
import type { Agent } from "../types.js";

export function now(): string {
  return new Date().toISOString();
}

export function genId(): string {
  return randomUUID();
}

export function normalizeAgentName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function parseAgent(row: Record<string, unknown>): Agent {
  return {
    ...(row as Omit<Agent, "capabilities" | "role">),
    capabilities: JSON.parse(row.capabilities as string) as string[],
    role: (row.role as Agent["role"]) ?? "agent",
    parent_agent_id: (row.parent_agent_id as string) ?? null,
    client_name: (row.client_name as string) ?? null,
    // Derived by costObservedSql(). Coerced rather than trusted so a read query
    // that omitted the fragment produces a definite 0 instead of undefined
    // leaking into the API response as a missing field.
    cost_observed_externally: Number(row.cost_observed_externally ?? 0),
  };
}
