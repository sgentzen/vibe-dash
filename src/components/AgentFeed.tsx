import { useAppState } from "../store";

const AGENT_ACTIVE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

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

  const activeAgents = agents.filter((a) => {
    const diff = Date.now() - new Date(a.last_seen_at).getTime();
    return diff < AGENT_ACTIVE_WINDOW_MS;
  });

  const recentActivity = activity.slice(0, 30);

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

        {activeAgents.length === 0 ? (
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
            {activeAgents.map((agent) => (
              <div
                key={agent.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <span
                  className="pulse-dot"
                  style={{ marginTop: "4px", flexShrink: 0 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "var(--accent-blue)",
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
                  <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>
                    {relativeTime(agent.last_seen_at)}
                  </div>
                </div>
              </div>
            ))}
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
              {recentActivity.map((entry) => (
                <div key={entry.id} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: "var(--border)",
                      flexShrink: 0,
                      marginTop: "5px",
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
