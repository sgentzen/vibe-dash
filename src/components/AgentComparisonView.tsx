import { useState, useEffect, type CSSProperties } from "react";
import { useApi } from "../hooks/useApi";
import type { AgentPerformance, AgentComparison, TaskTypeBreakdown } from "../types";
import { cardStyle, sectionHeader, emptyState } from "../styles/shared";
import { agentColor } from "../utils/agentColors";

type SortKey = "tasks_completed" | "total_lines_added" | "avg_duration_seconds" | "total_tests_added" | "avg_lines_per_task";

const SORT_LABELS: Record<SortKey, string> = {
  tasks_completed: "Tasks",
  total_lines_added: "Lines Added",
  avg_duration_seconds: "Avg Duration",
  total_tests_added: "Tests Added",
  avg_lines_per_task: "Lines/Task",
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ textAlign: "center", flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}

function AgentPerformanceCard({ perf, breakdown }: { perf: AgentPerformance; breakdown: TaskTypeBreakdown[] }) {
  const color = agentColor(perf.agent_name);
  const maxLines = Math.max(...breakdown.map((b) => b.avg_lines_added), 1);

  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${color}`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%", background: `${color}20`, color,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 700,
        }}>
          {perf.agent_name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text-primary)", fontSize: "13px" }}>{perf.agent_name}</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{perf.tasks_completed} tasks completed</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <StatBox label="Lines +" value={perf.total_lines_added.toLocaleString()} />
        <StatBox label="Lines -" value={perf.total_lines_removed.toLocaleString()} />
        <StatBox label="Files" value={perf.total_files_changed} />
        <StatBox label="Tests" value={perf.total_tests_added} />
        <StatBox label="Avg Time" value={formatDuration(perf.avg_duration_seconds)} />
      </div>

      {breakdown.length > 0 && (
        <div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase" }}>By Priority</div>
          {breakdown.map((b) => (
            <div key={b.priority} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: "11px", width: 55, color: "var(--text-secondary)" }}>{b.priority}</span>
              <div style={{ flex: 1, height: 6, background: "var(--bg-tertiary)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(b.avg_lines_added / maxLines) * 100}%`, height: "100%", background: color, borderRadius: 3 }} />
              </div>
              <span style={{ fontSize: "10px", color: "var(--text-muted)", width: 30, textAlign: "right" }}>{b.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const headerCell: CSSProperties = {
  fontSize: "10px", fontWeight: 600, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px",
  cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
};

const dataCell: CSSProperties = {
  fontSize: "13px", padding: "8px 12px", color: "var(--text-primary)", borderTop: "1px solid var(--border)",
};

export default function AgentComparisonView() {
  const api = useApi();
  const [comparison, setComparison] = useState<AgentComparison | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, TaskTypeBreakdown[]>>({});
  const [sortKey, setSortKey] = useState<SortKey>("tasks_completed");
  const [sortAsc, setSortAsc] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.getAgentComparison();
        if (cancelled) return;
        setComparison(data);

        const bdMap: Record<string, TaskTypeBreakdown[]> = {};
        await Promise.all(
          data.agents.map(async (a) => {
            try {
              bdMap[a.agent_id] = await api.getTaskTypeBreakdown(a.agent_id);
            } catch { bdMap[a.agent_id] = []; }
          })
        );
        if (!cancelled) setBreakdowns(bdMap);
      } catch { /* no metrics yet */ }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [api]);

  if (loading) {
    return <div style={emptyState}>Loading agent metrics...</div>;
  }

  if (!comparison || comparison.agents.length === 0) {
    return (
      <div style={emptyState}>
        No completion metrics recorded yet. Metrics are logged when agents complete tasks via the <code>log_completion_metrics</code> MCP tool or <code>POST /api/metrics</code> endpoint.
      </div>
    );
  }

  const sorted = [...comparison.agents].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? diff : -diff;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  }

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? " \u25B2" : " \u25BC") : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Leaderboard Table */}
      <div>
        <div style={sectionHeader}>Leaderboard</div>
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--bg-tertiary)" }}>
                <th style={{ ...headerCell, textAlign: "left" }}>#</th>
                <th style={{ ...headerCell, textAlign: "left" }}>Agent</th>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                  <th key={key} style={{ ...headerCell, textAlign: "right" }} onClick={() => toggleSort(key)}>
                    {SORT_LABELS[key]}{arrow(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((agent, i) => {
                const color = agentColor(agent.agent_name);
                return (
                  <tr key={agent.agent_id} style={{ background: i % 2 === 0 ? "transparent" : "var(--bg-tertiary)" }}>
                    <td style={dataCell}>{i + 1}</td>
                    <td style={dataCell}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          width: 20, height: 20, borderRadius: "50%", background: `${color}20`, color,
                          display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700,
                        }}>
                          {agent.agent_name.charAt(0).toUpperCase()}
                        </span>
                        {agent.agent_name}
                      </span>
                    </td>
                    <td style={{ ...dataCell, textAlign: "right", fontWeight: 600 }}>{agent.tasks_completed}</td>
                    <td style={{ ...dataCell, textAlign: "right" }}>{agent.total_lines_added.toLocaleString()}</td>
                    <td style={{ ...dataCell, textAlign: "right" }}>{formatDuration(agent.avg_duration_seconds)}</td>
                    <td style={{ ...dataCell, textAlign: "right" }}>{agent.total_tests_added}</td>
                    <td style={{ ...dataCell, textAlign: "right" }}>{Math.round(agent.avg_lines_per_task)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent Performance Cards */}
      <div>
        <div style={sectionHeader}>Agent Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {sorted.map((agent) => (
            <AgentPerformanceCard
              key={agent.agent_id}
              perf={agent}
              breakdown={breakdowns[agent.agent_id] ?? []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
