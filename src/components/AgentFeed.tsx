import { useAppState } from "../store";

const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const EVENT_AGE_OUT_MS = 10 * 60 * 1000; // 10 minutes

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

function agentColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

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

export function AgentFeed() {
  const { agents, activity } = useAppState();

  const sortedAgents = [...agents].sort(
    (a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
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
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "10px",
          }}
        >
          Active Agents
        </div>

        {sortedAgents.length === 0 ? (
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
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sortedAgents.map((agent) => {
              const isActive =
                Date.now() - new Date(agent.last_seen_at).getTime() < AGENT_ACTIVE_WINDOW_MS;
              const color = agentColor(agent.name);
              return (
                <div
                  key={agent.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    opacity: isActive ? 1 : 0.5,
                  }}
                >
                  <span
                    className={isActive ? "pulse-dot" : undefined}
                    style={{
                      marginTop: "4px",
                      flexShrink: 0,
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: isActive ? color : "var(--text-muted)",
                      display: "inline-block",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: isActive ? color : "var(--text-muted)",
                        fontSize: "13px",
                        fontWeight: 500,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {agent.name}
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
                      {relativeTime(agent.last_seen_at)}
                    </div>
                  </div>
                </div>
              );
            })}
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
