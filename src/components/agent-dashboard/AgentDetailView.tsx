import { agentColor, ROLE_COLORS } from "../../utils/agentColors";
import { cardStyle } from "../../styles/shared.js";
import type { AgentDetail } from "./types";

interface AgentDetailViewProps {
  detail: AgentDetail;
  onBack: () => void;
}

export function AgentDetailView({ detail, onBack }: AgentDetailViewProps) {
  const { agent, health_status, completed_today, current_task_title, activity, sessions } = detail;
  const color = agentColor(agent.name);
  const role = agent.role ?? "agent";
  const roleColor = ROLE_COLORS[role];
  const healthColor = health_status === "active" ? "var(--status-success)"
    : health_status === "idle" ? "var(--status-warning)" : "var(--text-muted)";

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <button onClick={onBack} style={{
        background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
        borderRadius: "6px", padding: "4px 12px", fontSize: "12px", cursor: "pointer", marginBottom: "16px",
      }}>
        Back to Dashboard
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-on-accent)", fontWeight: 700, fontSize: "16px" }}>
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "18px" }}>{agent.name}</span>
            {role !== "agent" && (
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "3px",
                  background: `color-mix(in srgb, ${roleColor} 15%, transparent)`,
                  color: roleColor,
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                {role}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthColor }} />
            {health_status} {agent.model && ` | ${agent.model}`}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--status-success)", fontFamily: "monospace" }}>{completed_today}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>COMPLETED TODAY</div>
        </div>
      </div>

      {current_task_title && (
        <div style={{ ...cardStyle, padding: "12px", marginBottom: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Currently working on</div>
          <div style={{ color: "var(--text-primary)", fontSize: "14px" }}>{current_task_title}</div>
        </div>
      )}

      {/* Sessions timeline */}
      <div style={{ marginBottom: "20px" }}>
        <h3 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Sessions ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No sessions recorded</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} style={{
                background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "6px",
                padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <span style={{ fontSize: "12px", color: "var(--text-primary)" }}>
                    {new Date(s.started_at).toLocaleString()}
                  </span>
                  {s.ended_at && (
                    <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
                      ended {new Date(s.ended_at).toLocaleTimeString()}
                    </span>
                  )}
                  {!s.ended_at && (
                    <span style={{ fontSize: "11px", color: "var(--status-success)", marginLeft: "8px" }}>active</span>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  {s.activity_count} activities
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h3 style={{ color: "var(--text-primary)", fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Recent Activity</h3>
        {activity.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No activity</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {activity.map((a) => (
              <div key={a.id} style={{
                fontSize: "12px", color: "var(--text-secondary)", padding: "6px 0",
                borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ color: "var(--text-muted)", fontSize: "10px", marginRight: "8px" }}>
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
                {a.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
