import { useState } from "react";
import type { Agent, Task } from "../../types";
import { cardStyle, sectionHeader } from "../../styles/shared.js";
import { agentColor } from "../../utils/agentColors.js";
import { HEALTH_COLORS } from "../../constants/colors.js";
import { relativeTime } from "../../utils/time.js";

interface LiveRosterCardProps {
  agents: Agent[];
  tasks: Task[];
}

function currentTask(agent: Agent, tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => t.assigned_agent_id === agent.id && t.status === "in_progress")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
}

const HEALTH_RANK: Record<string, number> = { active: 0, idle: 1, offline: 2 };

export function LiveRosterCard({ agents, tasks }: LiveRosterCardProps) {
  const [showOffline, setShowOffline] = useState(false);

  const sorted = [...agents].sort((a, b) => {
    const ra = HEALTH_RANK[a.health_status ?? "offline"] ?? 2;
    const rb = HEALTH_RANK[b.health_status ?? "offline"] ?? 2;
    if (ra !== rb) return ra - rb;
    return b.last_seen_at.localeCompare(a.last_seen_at);
  });
  const live = sorted.filter((a) => a.health_status !== "offline");
  const offline = sorted.filter((a) => a.health_status === "offline");

  return (
    <div style={cardStyle}>
      <div
        style={{
          ...sectionHeader,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Live Agents</span>
        <span style={{ color: "var(--text-muted)", fontSize: "11px", textTransform: "none", letterSpacing: "normal" }}>
          {live.filter((a) => a.health_status === "active").length} active
          {" · "}
          {live.filter((a) => a.health_status === "idle").length} idle
        </span>
      </div>

      {agents.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "12px 0" }}>
          No agents registered yet.
        </div>
      )}

      {live.map((a) => {
        const task = currentTask(a, tasks);
        const color = agentColor(a.name);
        const dot = HEALTH_COLORS[a.health_status ?? "offline"];
        return (
          <div
            key={a.id}
            style={{
              borderLeft: `3px solid ${color}`,
              background: "var(--bg-tertiary)",
              borderRadius: "6px",
              padding: "10px 12px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: dot,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{a.name}</span>
              </span>
              <span
                style={{
                  fontSize: "10px",
                  padding: "1px 6px",
                  borderRadius: "999px",
                  background: "var(--bg-primary)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                }}
              >
                {a.role}
              </span>
            </div>

            <div
              style={{
                marginTop: "6px",
                color: (a.current_status ?? a.current_task_title) ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: "13px",
              }}
            >
              {a.current_status ?? a.current_task_title ?? "— idle, no active task —"}
              {a.current_status && a.current_status_at && (
                <span style={{ color: "var(--text-muted)", fontSize: "11px", marginLeft: "6px" }}>
                  · {relativeTime(a.current_status_at)}
                </span>
              )}
            </div>

            {task && (
              <div
                style={{
                  height: "4px",
                  borderRadius: "2px",
                  background: "var(--bg-primary)",
                  overflow: "hidden",
                  margin: "7px 0 6px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${task.progress}%`,
                    background: "var(--accent-blue)",
                  }}
                />
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "var(--text-muted)",
                fontSize: "11px",
                marginTop: task ? 0 : "6px",
              }}
            >
              <span>
                {a.health_status ?? "offline"} · {relativeTime(a.last_seen_at)}
              </span>
              <span>✓ {a.completed_today ?? 0} today</span>
            </div>
          </div>
        );
      })}

      {offline.length > 0 && (
        <div>
          <div
            onClick={() => setShowOffline((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowOffline((v) => !v);
              }
            }}
            style={{
              cursor: "pointer",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "11px",
              padding: "6px",
              border: "1px dashed var(--border)",
              borderRadius: "6px",
            }}
          >
            ▸ {offline.length} offline {showOffline ? "(hide)" : "(click to expand)"}
          </div>
          {showOffline &&
            offline.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  opacity: 0.5,
                  fontSize: "12px",
                  padding: "4px 8px",
                }}
              >
                <span>{a.name}</span>
                <span>{relativeTime(a.last_seen_at)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
