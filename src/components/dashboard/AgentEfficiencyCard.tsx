import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { agentColor } from "../../utils/agentColors";
import type { AgentComparison } from "../../types";

export const AgentEfficiencyCard = memo(function AgentEfficiencyCard({ agentComparison }: { agentComparison: AgentComparison }) {
  if (agentComparison.agents.length === 0) return null;
  return (
    <CardWrapper title="Agent Efficiency" style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {agentComparison.agents.slice(0, 5).map((agent) => {
          const color = agentColor(agent.agent_name);
          const maxTasks = Math.max(...agentComparison.agents.map((a) => a.tasks_completed), 1);
          const pct = (agent.tasks_completed / maxTasks) * 100;
          const avgMin = Math.round(agent.avg_duration_seconds / 60);
          return (
            <div key={agent.agent_id}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                <span style={{ color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%", background: `${color}20`, color,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "8px", fontWeight: 700,
                  }}>{agent.agent_name.charAt(0).toUpperCase()}</span>
                  {agent.agent_name}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {agent.tasks_completed} tasks &middot; {avgMin}m avg &middot; {Math.round(agent.avg_lines_per_task)} lines/task
                </span>
              </div>
              <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "2px" }} />
              </div>
            </div>
          );
        })}
      </div>
    </CardWrapper>
  );
});
