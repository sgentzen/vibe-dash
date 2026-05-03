import type { Agent, AgentRole } from "../types";

export const ROLE_COLORS: Record<AgentRole, string> = {
  orchestrator: "var(--status-info)",
  coder: "var(--status-success)",
  reviewer: "var(--status-warning)",
  explorer: "var(--status-danger)",
  planner: "var(--accent-purple)",
  agent: "var(--text-muted)",
};

/** Group agents: root agents first, sub-agents nested under their parent */
export function groupAgents(agents: Agent[]): { parent: Agent; children: Agent[] }[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map<string, Agent[]>();
  const roots: Agent[] = [];

  for (const agent of agents) {
    if (agent.parent_agent_id && byId.has(agent.parent_agent_id)) {
      const list = childrenOf.get(agent.parent_agent_id) ?? [];
      list.push(agent);
      childrenOf.set(agent.parent_agent_id, list);
    } else {
      roots.push(agent);
    }
  }

  const byRecent = (a: Agent, b: Agent) =>
    new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  roots.sort(byRecent);

  return roots.map((parent) => ({
    parent,
    children: (childrenOf.get(parent.id) ?? []).sort(byRecent),
  }));
}

const AGENT_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
];

export function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}
