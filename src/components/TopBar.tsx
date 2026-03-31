import { useState } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { useAppDispatch } from "../store";

export function TopBar() {
  const { stats, activeView, searchQuery } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();
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
