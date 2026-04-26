import { useState, useEffect, useMemo } from "react";
import { useDataState, usePollingState } from "../store";
import { useApi } from "../hooks/useApi";
import { inputStyle } from "../styles/shared.js";
import type { ActivityEntry } from "../types";

const LAST_VISIT_KEY = "vibe-dash-last-visit";

export function ActivityStreamView() {
  const { projects, agents } = useDataState();
  const { pollGeneration } = usePollingState();
  const api = useApi();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [showSince, setShowSince] = useState(false);

  const lastVisit = useMemo(() => {
    const stored = localStorage.getItem(LAST_VISIT_KEY);
    return stored ?? null;
  }, []);

  useEffect(() => {
    // Record this visit
    localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const params: Record<string, string | undefined> = {
          limit: "200",
        };
        if (filterAgent) params.agent_id = filterAgent;
        if (filterProject) params.project_id = filterProject;
        if (showSince && lastVisit) params.since = lastVisit;
        const data = await api.getActivityStream(params);
        setEntries(data);
      } catch {
        // ignore
      }
    }
    load();
  }, [api, filterAgent, filterProject, showSince, lastVisit, pollGeneration]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { label: string; items: ActivityEntry[] }[] = [];
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let currentLabel = "";
    let currentItems: ActivityEntry[] = [];

    for (const entry of entries) {
      const dateStr = entry.timestamp.slice(0, 10);
      let label: string;
      if (dateStr === todayStr) label = "Today";
      else if (dateStr === yesterday) label = "Yesterday";
      else label = dateStr;

      if (label !== currentLabel) {
        if (currentItems.length > 0) groups.push({ label: currentLabel, items: currentItems });
        currentLabel = label;
        currentItems = [];
      }
      currentItems.push(entry);
    }
    if (currentItems.length > 0) groups.push({ label: currentLabel, items: currentItems });

    return groups;
  }, [entries]);

  const selectStyle: React.CSSProperties = { ...inputStyle, width: "auto", borderRadius: "4px", padding: "4px 8px", fontSize: "12px" };

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "12px", fontWeight: 600 }}>
        Activity Stream
      </h2>

      {/* Filters */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px", flexWrap: "wrap" }}>
        <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} style={selectStyle}>
          <option value="">All agents</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>

        <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} style={selectStyle}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showSince}
            onChange={(e) => setShowSince(e.target.checked)}
          />
          Since last visit
          {lastVisit && <span style={{ color: "var(--text-muted)", fontSize: "10px" }}>({new Date(lastVisit).toLocaleString()})</span>}
        </label>

        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          {entries.length} entries
        </span>
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>
          No activity to show
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
          {grouped.map((group) => (
            <div key={group.label}>
              <div style={{
                fontSize: "12px", fontWeight: 600, color: "var(--text-primary)",
                padding: "8px 0 4px", borderBottom: "1px solid var(--border)",
                position: "sticky", top: 0, background: "var(--bg-primary)", zIndex: 1,
              }}>
                {group.label}
              </div>
              {group.items.map((entry) => (
                <div key={entry.id} style={{
                  padding: "6px 0", borderBottom: "1px solid var(--border)",
                  display: "flex", gap: "8px", fontSize: "12px",
                }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "10px", minWidth: "60px", flexShrink: 0 }}>
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span style={{ color: "var(--accent-blue)", fontWeight: 500, minWidth: "80px", flexShrink: 0 }}>
                    {entry.agent_name ?? "System"}
                    {entry.parent_agent_name && (
                      <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: "10px" }}>
                        {" "}&rarr; {entry.parent_agent_name}
                      </span>
                    )}
                  </span>
                  {entry.project_name && (
                    <span style={{
                      fontSize: "10px", padding: "0 4px", borderRadius: "3px",
                      background: "rgba(139, 92, 246, 0.1)", color: "var(--accent-purple)",
                      alignSelf: "center", flexShrink: 0, lineHeight: "16px",
                    }}>
                      {entry.project_name}
                    </span>
                  )}
                  <span style={{ color: "var(--text-secondary)", flex: 1 }}>
                    {entry.message}
                  </span>
                  {entry.task_title && (
                    <span style={{ color: "var(--text-muted)", fontSize: "10px", flexShrink: 0 }}>
                      on {entry.task_title}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
