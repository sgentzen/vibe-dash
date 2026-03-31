import { useState } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { useAppDispatch } from "../store";

export function TopBar() {
  const { stats, activeView, searchQuery, unreadCount, notifications } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleAdd() {
    const name = projectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const project = await api.createProject({ name });
      dispatch({ type: "WS_EVENT", payload: { type: "project_created", payload: project } });
      setProjectName("");
      setShowForm(false);
    } catch {
      // silently ignore — backend WS will update state if it goes through
    } finally {
      setCreating(false);
    }
  }

  return (
    <header
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        padding: "0 16px",
        height: "52px",
        display: "flex",
        alignItems: "center",
        gap: "24px",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <span
        style={{
          color: "var(--accent-red)",
          fontWeight: 700,
          fontSize: "16px",
          letterSpacing: "0.1em",
          fontFamily: "monospace",
          whiteSpace: "nowrap",
        }}
      >
        VIBE DASH
      </span>

      {/* Stats */}
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        <StatPill label="PROJECTS" value={stats.projects} color="var(--accent-blue)" />
        <StatPill label="AGENTS" value={stats.activeAgents} color="var(--accent-green)" />
        <StatPill label="ALERTS" value={stats.alerts} color="var(--accent-yellow)" />
        <StatPill label="TASKS" value={stats.tasks} color="var(--text-secondary)" />
      </div>

      {/* View Toggle */}
      <div style={{ display: "flex", gap: "2px", background: "var(--bg-tertiary)", borderRadius: "6px", padding: "2px" }}>
        <button
          onClick={() => dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" })}
          style={{
            ...viewBtnStyle,
            background: activeView === "board" ? "var(--bg-primary)" : "transparent",
            color: activeView === "board" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          Board
        </button>
        <button
          onClick={() => dispatch({ type: "SET_ACTIVE_VIEW", payload: "agents" })}
          style={{
            ...viewBtnStyle,
            background: activeView === "agents" ? "var(--bg-primary)" : "transparent",
            color: activeView === "agents" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          Agents
        </button>
        <button
          onClick={() => dispatch({ type: "SET_ACTIVE_VIEW", payload: "list" })}
          style={{
            ...viewBtnStyle,
            background: activeView === "list" ? "var(--bg-primary)" : "transparent",
            color: activeView === "list" ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          List
        </button>
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => dispatch({ type: "SET_SEARCH_QUERY", payload: e.target.value })}
        placeholder="Search tasks..."
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          color: "var(--text-primary)",
          padding: "4px 10px",
          fontSize: "13px",
          width: "200px",
          outline: "none",
        }}
      />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Notification Bell */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowNotifications(!showNotifications)}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "4px 8px",
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: "14px",
            position: "relative",
          }}
        >
          {"\uD83D\uDD14"}
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: "-4px", right: "-4px",
              background: "var(--accent-red)", color: "#fff",
              fontSize: "10px", fontWeight: 700, borderRadius: "50%",
              width: "16px", height: "16px", display: "flex",
              alignItems: "center", justifyContent: "center",
            }}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {showNotifications && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: "4px",
            background: "var(--bg-secondary)", border: "1px solid var(--border)",
            borderRadius: "8px", width: "320px", maxHeight: "400px",
            overflowY: "auto", zIndex: 100, boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}>
            <div style={{
              padding: "8px 12px", borderBottom: "1px solid var(--border)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={async () => {
                    await api.markAllRead();
                    dispatch({ type: "SET_UNREAD_COUNT", payload: 0 });
                    dispatch({ type: "SET_NOTIFICATIONS", payload: notifications.map((n) => ({ ...n, read: true })) });
                  }}
                  style={{ background: "transparent", border: "none", color: "var(--accent-blue)", fontSize: "11px", cursor: "pointer" }}
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                No notifications
              </div>
            ) : (
              notifications.slice(0, 20).map((n) => (
                <div
                  key={n.id}
                  onClick={async () => {
                    if (!n.read) {
                      await api.markNotificationRead(n.id);
                      dispatch({ type: "SET_UNREAD_COUNT", payload: Math.max(0, unreadCount - 1) });
                      dispatch({ type: "SET_NOTIFICATIONS", payload: notifications.map((x) => x.id === n.id ? { ...x, read: true } : x) });
                    }
                  }}
                  style={{
                    padding: "8px 12px", borderBottom: "1px solid var(--border)",
                    cursor: "pointer", background: n.read ? "transparent" : "rgba(99,102,241,0.05)",
                  }}
                >
                  <div style={{ fontSize: "12px", color: n.read ? "var(--text-muted)" : "var(--text-primary)" }}>
                    {n.message}
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Add Project */}
      {showForm ? (
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            autoFocus
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowForm(false); setProjectName(""); }
            }}
            placeholder="Project name..."
            style={{
              background: "var(--bg-tertiary)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              color: "var(--text-primary)",
              padding: "4px 10px",
              fontSize: "13px",
              width: "180px",
              outline: "none",
            }}
          />
          <button
            onClick={handleAdd}
            disabled={creating || !projectName.trim()}
            style={btnStyle("var(--accent-green)")}
          >
            Add
          </button>
          <button
            onClick={() => { setShowForm(false); setProjectName(""); }}
            style={btnStyle("var(--text-muted)")}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setShowForm(true)} style={btnStyle("var(--accent-blue)")}>
          + New Project
        </button>
      )}
    </header>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <span style={{ color, fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
        {value}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: "10px", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </div>
  );
}

const viewBtnStyle: React.CSSProperties = {
  border: "none",
  borderRadius: "4px",
  padding: "4px 10px",
  fontSize: "12px",
  cursor: "pointer",
  fontWeight: 500,
};

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${bg}`,
    color: bg,
    borderRadius: "6px",
    padding: "4px 12px",
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
