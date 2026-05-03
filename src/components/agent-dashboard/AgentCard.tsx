import { agentColor, agentGlyph, ROLE_COLORS } from "../../utils/agentColors";
import { cardStyle } from "../../styles/shared.js";
import type { Agent, AgentCost } from "../../types";
import type { AgentDetail } from "./types";

interface AgentCardProps {
  agent: Agent;
  detail?: AgentDetail;
  cost?: AgentCost;
  onClick: () => void;
}

export function AgentCard({ agent, detail, onClick }: AgentCardProps) {
  const color = agentColor(agent.name);
  const role = agent.role ?? "agent";
  const roleColor = ROLE_COLORS[role];
  const healthColor = detail?.health_status === "active" ? "var(--status-success)"
    : detail?.health_status === "idle" ? "var(--status-warning)" : "var(--text-muted)";

  return (
    <div
      onClick={onClick}
      style={{
        ...cardStyle,
        padding: "12px",
        cursor: "pointer",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        {/* Avatar */}
        <div
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: color,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-on-accent)",
            fontWeight: 700,
            fontSize: "12px",
            flexShrink: 0,
          }}
        >
          {agentGlyph(agent)}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "14px" }}>{agent.name}</span>
            {role !== "agent" && (
              <span
                style={{
                  fontSize: "9px",
                  padding: "0 4px",
                  borderRadius: "3px",
                  background: `color-mix(in srgb, ${roleColor} 15%, transparent)`,
                  color: roleColor,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  lineHeight: "16px",
                }}
              >
                {role}
              </span>
            )}
          </div>
        </div>
        <span role="img" aria-label={`Status: ${detail?.health_status ?? "unknown"}`} style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthColor, flexShrink: 0 }} />
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{detail?.health_status ?? "..."}</span>
      </div>

      {detail?.current_task_title && (
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>
          ↳ <span style={{ color: "var(--text-primary)" }}>{detail.current_task_title}</span>
        </div>
      )}

      {agent.current_project_name && (
        <div style={{ marginBottom: "8px" }}>
          <span style={{
            fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
            background: "rgba(139, 92, 246, 0.1)", color: "var(--accent-purple)",
            border: "1px solid rgba(139, 92, 246, 0.3)",
          }}>
            {agent.current_project_name}
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text-muted)" }}>
        <span>Completed today: <strong style={{ color: "var(--status-success)" }}>{detail?.completed_today ?? 0}</strong></span>
        {((detail?.sessions.length ?? 0) > 0 || (detail?.completed_today ?? 0) === 0) && (
          <span>Sessions: <strong>{detail?.sessions.length ?? 0}</strong></span>
        )}
      </div>

      {agent.model && (
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "8px" }}>
          Model: {agent.model}
        </div>
      )}

      {agent.capabilities && agent.capabilities.length > 0 && (
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "6px" }}>
          {agent.capabilities.map((cap) => (
            <span key={cap} style={{
              fontSize: "10px", padding: "1px 6px", borderRadius: "4px",
              background: "rgba(99,102,241,0.1)", color: "var(--accent-purple)",
              border: "1px solid rgba(99,102,241,0.3)",
            }}>
              {cap}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
