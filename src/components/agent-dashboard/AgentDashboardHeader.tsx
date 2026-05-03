import { FILTER_LABELS, type StatusFilter } from "./types";

interface AgentDashboardHeaderProps {
  viewMode: "agents" | "performance";
  onViewModeChange: (mode: "agents" | "performance") => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
}

export function AgentDashboardHeader({
  viewMode,
  onViewModeChange,
  statusFilter,
  onStatusFilterChange,
}: AgentDashboardHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, margin: 0 }}>
        Agent Dashboard
      </h2>
      <div style={{ display: "flex", gap: "4px" }}>
        {(["agents", "performance"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            style={{
              background: viewMode === mode ? "var(--accent-blue)" : "transparent",
              border: `1px solid ${viewMode === mode ? "var(--accent-blue)" : "var(--border)"}`,
              color: viewMode === mode ? "var(--text-on-accent)" : "var(--text-muted)",
              borderRadius: "4px",
              padding: "2px 10px",
              fontSize: "11px",
              cursor: "pointer",
            }}
          >
            {mode === "agents" ? "Agents" : "Performance"}
          </button>
        ))}
      </div>
      {viewMode === "agents" && (
        <div style={{ display: "flex", gap: "4px" }}>
          {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => onStatusFilterChange(f)}
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
      )}
    </div>
  );
}
