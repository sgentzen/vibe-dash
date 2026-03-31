import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { agentColor } from "../utils/agentColors";
import type { Agent, ActivityEntry, AgentSession } from "../types";

interface AgentDetail {
  agent: Agent;
  health_status: string;
  completed_today: number;
  current_task_title: string | null;
  activity: ActivityEntry[];
  sessions: AgentSession[];
}

export function AgentDashboard() {
  const { agents } = useAppState();
  const api = useApi();
  const [details, setDetails] = useState<Record<string, AgentDetail>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    async function loadDetails() {
      const entries = await Promise.all(
        agents.map(async (agent): Promise<[string, AgentDetail] | null> => {
          try {
            const [detail, activity, sessions] = await Promise.all([
              api.getAgentDetail(agent.id),
              api.getAgentActivity(agent.id, 10),
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
      );
      const results: Record<string, AgentDetail> = {};
      for (const entry of entries) {
        if (entry) results[entry[0]] = entry[1];
      }
      setDetails(results);
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

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "16px", fontWeight: 600 }}>
        Agent Dashboard
      </h2>
      {agents.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          No agents registered yet
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px" }}>
          {agents.map((agent) => {
            const d = details[agent.id];
            const color = agentColor(agent.name);
            const healthColor = d?.health_status === "active" ? "var(--accent-green)"
              : d?.health_status === "idle" ? "var(--accent-yellow)" : "var(--text-muted)";

            return (
              <div
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                style={{
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "16px",
                  cursor: "pointer",
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthColor, flexShrink: 0 }} />
                  <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "14px" }}>{agent.name}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "auto" }}>{d?.health_status ?? "..."}</span>
                </div>

                {d?.current_task_title && (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
                    Working on: <span style={{ color: "var(--text-primary)" }}>{d.current_task_title}</span>
                  </div>
                )}

                <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text-muted)" }}>
                  <span>Completed today: <strong style={{ color: "var(--accent-green)" }}>{d?.completed_today ?? 0}</strong></span>
                  <span>Sessions: <strong>{d?.sessions.length ?? 0}</strong></span>
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
                        background: "rgba(99,102,241,0.1)", color: "#6366f1",
                      }}>
                        {cap}
                      </span>
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

function AgentDetailView({ detail, onBack }: { detail: AgentDetail; onBack: () => void }) {
  const { agent, health_status, completed_today, current_task_title, activity, sessions } = detail;
  const color = agentColor(agent.name);
  const healthColor = health_status === "active" ? "var(--accent-green)"
    : health_status === "idle" ? "var(--accent-yellow)" : "var(--text-muted)";

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <button onClick={onBack} style={{
        background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
        borderRadius: "6px", padding: "4px 12px", fontSize: "12px", cursor: "pointer", marginBottom: "16px",
      }}>
        Back to Dashboard
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "16px" }}>
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "18px" }}>{agent.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthColor }} />
            {health_status} {agent.model && ` | ${agent.model}`}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--accent-green)", fontFamily: "monospace" }}>{completed_today}</div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>COMPLETED TODAY</div>
        </div>
      </div>

      {current_task_title && (
        <div style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
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
                    <span style={{ fontSize: "11px", color: "var(--accent-green)", marginLeft: "8px" }}>active</span>
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
