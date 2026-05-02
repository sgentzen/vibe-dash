import { useState } from "react";
import { useAppState } from "../store";
import { agentColor, ROLE_COLORS, groupAgents } from "../utils/agentColors";
import { HEALTH_COLORS, HEALTH_LABELS } from "../constants/colors.js";
import type { Agent, AgentHealthStatus } from "../types";

// Keep in sync with server/db.ts ACTIVE_THRESHOLD_MS / IDLE_THRESHOLD_MS
const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const EVENT_AGE_OUT_MS = 10 * 60 * 1000; // 10 minutes

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.max(0, Math.floor(diff / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getHealthStatus(lastSeenAt: string): AgentHealthStatus {
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsed < AGENT_ACTIVE_WINDOW_MS) return "active";
  if (elapsed < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}


export function AgentFeed({ onCollapse }: { onCollapse: () => void }) {
  const { agents, activity } = useAppState();
  const groups = groupAgents(agents);
  const [showOffline, setShowOffline] = useState(false);

  // Split groups into active (parent or any child not offline) vs offline
  const activeGroups: typeof groups = [];
  const offlineGroups: typeof groups = [];
  for (const group of groups) {
    const parentHealth = getHealthStatus(group.parent.last_seen_at);
    const anyChildActive = group.children.some(
      (c) => getHealthStatus(c.last_seen_at) !== "offline"
    );
    if (parentHealth !== "offline" || anyChildActive) {
      activeGroups.push(group);
    } else {
      offlineGroups.push(group);
    }
  }

  const offlineAgentCount = offlineGroups.reduce(
    (n, g) => n + 1 + g.children.length, 0
  );

  const now = Date.now();
  const recentActivity = activity.filter(
    (e) => now - new Date(e.timestamp).getTime() < EVENT_AGE_OUT_MS
  ).slice(0, 30);

  return (
    <aside
      className="panel-scroll"
      style={{
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Active Agents section */}
      <div
        style={{
          padding: "12px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Active Agents
          </div>
          <button
            onClick={onCollapse}
            title="Collapse agent feed"
            aria-label="Collapse agent feed"
            style={{
              background: "transparent",
              border: "none",
              padding: "2px 4px",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: "12px",
              lineHeight: 1,
              borderRadius: "3px",
            }}
          >
            ›
          </button>
        </div>

        {activeGroups.length === 0 ? (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "12px",
              fontStyle: "italic",
              padding: "4px 0",
            }}
          >
            No active agents
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {activeGroups.map(({ parent, children }) => (
              <div key={parent.id}>
                <AgentRow agent={parent} indent={false} />
                {children.length > 0 && (
                  <div
                    style={{
                      marginLeft: "16px",
                      borderLeft: `2px solid ${agentColor(parent.name)}`,
                      paddingLeft: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      marginTop: "4px",
                    }}
                  >
                    {children.map((child) => (
                      <AgentRow key={child.id} agent={child} indent={true} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Offline Agents — collapsed by default */}
        {offlineAgentCount > 0 && (
          <div style={{ marginTop: "10px" }}>
            <button
              onClick={() => setShowOffline(!showOffline)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                fontSize: "10px",
                color: "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "8px" }}>{showOffline ? "\u25BC" : "\u25B6"}</span>
              Offline ({offlineAgentCount})
            </button>
            {showOffline && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px", opacity: 0.5 }}>
                {offlineGroups.map(({ parent, children }) => (
                  <div key={parent.id}>
                    <AgentRow agent={parent} indent={false} />
                    {children.length > 0 && (
                      <div
                        style={{
                          marginLeft: "16px",
                          borderLeft: `2px solid ${agentColor(parent.name)}`,
                          paddingLeft: "8px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          marginTop: "4px",
                        }}
                      >
                        {children.map((child) => (
                          <AgentRow key={child.id} agent={child} indent={true} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Recent Events section */}
      <div
        style={{
          flex: 1,
          padding: "12px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "10px",
            flexShrink: 0,
          }}
        >
          Recent Events
        </div>

        <div className="panel-scroll" style={{ flex: 1 }}>
          {recentActivity.length === 0 ? (
            <div
              style={{
                color: "var(--text-muted)",
                fontSize: "12px",
                fontStyle: "italic",
              }}
            >
              No recent events
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {recentActivity.map((entry) => {
                const entryColor = entry.agent_name ? agentColor(entry.agent_name) : null;
                return (
                  <div key={entry.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: entryColor ?? "var(--border)",
                        flexShrink: 0,
                        marginTop: "5px",
                      }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      {entry.agent_name && (
                        <div
                          style={{
                            color: entryColor ?? "var(--text-muted)",
                            fontSize: "11px",
                            fontWeight: 600,
                            marginBottom: "1px",
                          }}
                        >
                          {entry.agent_name}
                        </div>
                      )}
                      <div
                        style={{
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          lineHeight: 1.4,
                        }}
                      >
                        {entry.message}
                      </div>
                      <div style={{ color: "var(--text-muted)", fontSize: "10px", marginTop: "2px" }}>
                        {relativeTime(entry.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function AgentRow({ agent, indent }: { agent: Agent; indent: boolean }) {
  const health = getHealthStatus(agent.last_seen_at);
  const healthColor = HEALTH_COLORS[health];
  const color = agentColor(agent.name);
  const isActive = health === "active";
  const roleColor = ROLE_COLORS[agent.role ?? "agent"];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        opacity: health === "offline" ? 0.5 : 1,
      }}
    >
      {/* Avatar with initial */}
      <div
        style={{
          width: indent ? "22px" : "26px",
          height: indent ? "22px" : "26px",
          borderRadius: "50%",
          background: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-on-accent)",
          fontWeight: 700,
          fontSize: indent ? "10px" : "11px",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {agent.name.charAt(0).toUpperCase()}
        {/* Health dot overlay */}
        <span
          className={isActive ? "pulse-dot" : undefined}
          aria-label={`Status: ${HEALTH_LABELS[health]}`}
          role="img"
          style={{
            position: "absolute",
            bottom: "-1px",
            right: "-1px",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: healthColor,
            border: "2px solid var(--bg-secondary)",
          }}
        />
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              color: isActive ? color : health === "idle" ? "var(--text-secondary)" : "var(--text-muted)",
              fontSize: indent ? "12px" : "13px",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.name}
          </span>
          {/* Role badge */}
          {agent.role && agent.role !== "agent" && (
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
                whiteSpace: "nowrap",
                lineHeight: "16px",
              }}
            >
              {agent.role}
            </span>
          )}
        </div>
        {agent.model && (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.model}
          </div>
        )}
        {agent.current_project_name && (
          <div
            style={{
              fontSize: "10px",
              color: "var(--accent-purple)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: "1px",
            }}
          >
            {agent.current_project_name}
          </div>
        )}
        {agent.current_task_title && isActive && (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: "1px",
            }}
          >
            <span style={{ color: "var(--text-muted)", opacity: 0.7 }}>Working on: </span>
            <span style={{ color: "var(--text-primary)" }}>{agent.current_task_title}</span>
          </div>
        )}
        <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
          {HEALTH_LABELS[health]} · {relativeTime(agent.last_seen_at)}
        </div>
      </div>
    </div>
  );
}
