import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { agentColor, groupAgents } from "../utils/agentColors";
import type { Agent, AgentCost } from "../types";
import AgentComparisonView from "./AgentComparisonView";
import { AgentCard } from "./agent-dashboard/AgentCard";
import { AgentDetailView } from "./agent-dashboard/AgentDetailView";
import { AgentDashboardHeader } from "./agent-dashboard/AgentDashboardHeader";
import type { AgentDetail, StatusFilter } from "./agent-dashboard/types";

export function AgentDashboard() {
  const { agents } = useAppState();
  const api = useApi();
  const [details, setDetails] = useState<Record<string, AgentDetail>>({});
  const [costMap, setCostMap] = useState<Record<string, AgentCost>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active+idle");
  const [viewMode, setViewMode] = useState<"agents" | "performance">("agents");

  useEffect(() => {
    async function loadDetails() {
      const [entries, costEntries] = await Promise.all([
        Promise.all(
          agents.map(async (agent): Promise<[string, AgentDetail] | null> => {
            try {
              const [detail, activity, sessions] = await Promise.all([
                api.getAgentDetail(agent.id),
                api.getAgentActivity(agent.id, 30),
                api.getAgentSessions(agent.id),
              ]);
              return [agent.id, {
                agent,
                health_status: detail.health_status,
                completed_today: detail.completed_today,
                current_task_title: detail.current_task_title ?? null,
                activity,
                sessions,
              }];
            } catch {
              return null;
            }
          })
        ),
        api.getCostByAgent().catch(() => [] as { agent_id: string; total_cost_usd: number; total_tokens: number }[]),
      ]);

      const results: Record<string, AgentDetail> = {};
      for (const entry of entries) {
        if (entry) results[entry[0]] = entry[1];
      }
      setDetails(results);

      const costs: Record<string, AgentCost> = {};
      for (const c of costEntries) {
        costs[c.agent_id] = { total_cost_usd: c.total_cost_usd, total_tokens: c.total_tokens };
      }
      setCostMap(costs);
    }
    if (agents.length > 0) loadDetails();
  }, [agents, api]);

  const selectedDetail = selectedAgentId ? details[selectedAgentId] : null;

  if (selectedDetail) {
    return (
      <AgentDetailView
        detail={selectedDetail}
        onBack={() => setSelectedAgentId(null)}
      />
    );
  }

  const allGroups = groupAgents(agents);

  // Use health_status from the enriched API response (available on agents from /api/agents)
  function agentHealth(agent: Agent): string {
    return (agent as Agent & { health_status?: string }).health_status
      ?? details[agent.id]?.health_status
      ?? "offline";
  }

  // Filter groups by status
  const groups = allGroups.filter(({ parent, children }) => {
    if (statusFilter === "all") return true;
    const allStatuses = [parent, ...children].map(agentHealth);
    if (statusFilter === "active+idle") {
      return allStatuses.some((s) => s === "active" || s === "idle");
    }
    // "offline" filter
    return allStatuses.every((s) => s === "offline");
  });

  // Sort: active first, then idle, then offline
  const statusOrder: Record<string, number> = { active: 0, idle: 1, offline: 2 };
  groups.sort((a, b) => {
    const aStatus = agentHealth(a.parent);
    const bStatus = agentHealth(b.parent);
    return (statusOrder[aStatus] ?? 2) - (statusOrder[bStatus] ?? 2);
  });

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <AgentDashboardHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />
      {viewMode === "performance" ? (
        <AgentComparisonView />
      ) : agents.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          No agents registered yet
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {groups.map(({ parent, children }) => {
            return (
              <div key={parent.id}>
                <AgentCard
                  agent={parent}
                  detail={details[parent.id]}
                  cost={costMap[parent.id]}
                  onClick={() => setSelectedAgentId(parent.id)}
                />
                {children.length > 0 && (
                  <div
                    style={{
                      marginLeft: "20px",
                      borderLeft: `2px solid ${agentColor(parent.name)}`,
                      paddingLeft: "12px",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                      gap: "8px",
                      marginTop: "8px",
                    }}
                  >
                    {children.map((child) => (
                      <AgentCard
                        key={child.id}
                        agent={child}
                        detail={details[child.id]}
                        cost={costMap[child.id]}
                        onClick={() => setSelectedAgentId(child.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}