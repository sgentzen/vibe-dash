import { useState } from "react";
import { useAppState } from "../store";
import { agentColor, agentGlyph, ROLE_COLORS, groupAgents } from "../utils/agentColors";
import { HEALTH_COLORS, HEALTH_LABELS } from "../constants/colors.js";
import type { Agent, AgentHealthStatus } from "../types";
import { relativeTime } from "../utils/time";

function feedNameColor(isActive: boolean, activeColor: string, health: AgentHealthStatus): string {
  if (isActive) return activeColor;
  if (health === "idle") return "var(--text-secondary)";
  return "var(--text-muted)";
}

// Keep in sync with server/db.ts ACTIVE_THRESHOLD_MS / IDLE_THRESHOLD_MS
const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function getHealthStatus(lastSeenAt: string): AgentHealthStatus {
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (elapsed < AGENT_ACTIVE_WINDOW_MS) return "active";
  if (elapsed < IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}


export function AgentFeed({ onCollapse }: Readonly<{ onCollapse: () => void }>) {
  const { agents } = useAppState();
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

  return (
    <aside
      aria-label="Agent feed"
      className="panel-scroll"
      style={{
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Active Agents roster — "who's active now" (full timeline lives in the Feed tab) */}
      <section
        className="panel-scroll"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region needs keyboard access (WCAG 2.1.1)
        tabIndex={0}
        aria-label="Agent activity"
        style={{
          padding: "var(--space-3)",
          flex: 1,
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
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
          <div style={{ marginTop: "var(--space-2)" }}>
            <button
              onClick={() => setShowOffline(!showOffline)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                fontSize: "11px",
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
      </section>
    </aside>
  );
}

function AgentRow({ agent, indent }: Readonly<{ agent: Agent; indent: boolean }>) {
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
          fontSize: "11px",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {agentGlyph(agent)}
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
              color: feedNameColor(isActive, color, health),
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
                fontSize: "11px",
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
              fontSize: "11px",
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
        <div style={{ color: "var(--text-muted)", fontSize: "11px" }}>
          {HEALTH_LABELS[health]} · {relativeTime(agent.last_seen_at)}
        </div>
      </div>
    </div>
  );
}
