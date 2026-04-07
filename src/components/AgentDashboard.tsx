import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { agentColor, ROLE_COLORS, groupAgents } from "../utils/agentColors";
import { cardStyle, badgeStyle, sectionHeader } from "../styles/shared.js";
import type { Agent, ActivityEntry, AgentSession } from "../types";

interface AgentDetail {
  agent: Agent;
  health_status: string;
  completed_today: number;
  current_task_title: string | null;
  activity: ActivityEntry[];
  sessions: AgentSession[];
}

type StatusFilter = "active+idle" | "all" | "offline";

const FILTER_LABELS: Record<StatusFilter, string> = {
  "active+idle": "Active",
  all: "All",
  offline: "Offline",
};

export function AgentDashboard() {
  const { agents } = useAppState();
  const api = useApi();
  const [details, setDetails] = useState<Record<string, AgentDetail>>({});
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active+idle");

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
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <h2 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, margin: 0 }}>
          Agent Dashboard
        </h2>
        <div style={{ display: "flex", gap: "4px" }}>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              style={{
                background: statusFilter === f ? "var(--accent-blue)" : "transparent",
                border: `1px solid ${statusFilter === f ? "var(--accent-blue)" : "var(--border)"}`,
                color: statusFilter === f ? "var(--text-on-accent)" : "var(--text-muted)",
                borderRadius: "4px",
                padding: "2px 8px",
                fontSize: "11px",
                cursor: "pointer",
              }}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}
        </div>
      </div>
      {agents.length === 0 ? (
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

function AgentCard({ agent, detail, onClick }: { agent: Agent; detail?: AgentDetail; onClick: () => void }) {
  const color = agentColor(agent.name);
  const role = agent.role ?? "agent";
  const roleColor = ROLE_COLORS[role];
  const healthColor = detail?.health_status === "active" ? "var(--accent-green)"
    : detail?.health_status === "idle" ? "var(--accent-yellow)" : "var(--text-muted)";

  return (
    <div
      onClick={onClick}
      style={{
        ...cardStyle,
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
          {agent.name.charAt(0).toUpperCase()}
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
        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: healthColor, flexShrink: 0 }} />
        <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>{detail?.health_status ?? "..."}</span>
      </div>

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

      {detail?.current_task_title && (
        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
          Working on: <span style={{ color: "var(--text-primary)" }}>{detail.current_task_title}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", fontSize: "11px", color: "var(--text-muted)" }}>
        <span>Completed today: <strong style={{ color: "var(--accent-green)" }}>{detail?.completed_today ?? 0}</strong></span>
        <span>Sessions: <strong>{detail?.sessions.length ?? 0}</strong></span>
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

function AgentDetailView({ detail, onBack }: { detail: AgentDetail; onBack: () => void }) {
  const { agent, health_status, completed_today, current_task_title, activity, sessions } = detail;
  const color = agentColor(agent.name);
  const role = agent.role ?? "agent";
  const roleColor = ROLE_COLORS[role];
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
          <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--accent-green)", fontFamily: "monospace" }}>{completed_today}</div>
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
