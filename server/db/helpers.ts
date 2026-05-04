import { randomUUID } from "crypto";
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
  };
}
