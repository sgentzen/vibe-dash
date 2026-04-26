import type { Blocker, Task } from "../../types";

interface Props {
  blockers: Blocker[];
  tasks: Task[];
}

type Severity = "critical" | "high" | "medium" | "low";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function getSeverity(task: Task | undefined): Severity {
  if (!task) return "medium";
  switch (task.priority) {
    case "urgent": return "critical";
    case "high": return "high";
    case "medium": return "medium";
    case "low": return "low";
    default: return "medium";
  }
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "var(--accent-red)",
  high: "var(--accent-yellow)",
  medium: "var(--accent-blue)",
  low: "var(--text-muted)",
};

export function ActiveBlockersPanel({ blockers, tasks }: Props) {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const sorted = [...blockers].sort((a, b) => {
    const sa = SEVERITY_ORDER.indexOf(getSeverity(taskMap.get(a.task_id)));
    const sb = SEVERITY_ORDER.indexOf(getSeverity(taskMap.get(b.task_id)));
    return sa - sb;
  });

  return (
    <div className="orch-card" style={{ display: "flex", flexDirection: "column", maxHeight: 260, minHeight: 0 }}>
      <div className="orch-section-header">Active Blockers</div>
      {sorted.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
          No active blockers
        </div>
      ) : (
        <ul role="list" style={{ overflowY: "auto", flex: 1, listStyle: "none", padding: 0, margin: 0 }} className="orch-blocker-list">
          {sorted.map((b) => {
            const severity = getSeverity(taskMap.get(b.task_id));
            const color = SEVERITY_COLOR[severity];
            return (
              <li
                key={b.id}
                role="listitem"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 0",
                  borderBottom: "1px solid var(--border)",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLLIElement).style.background = "var(--bg-tertiary)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLLIElement).style.background = "transparent";
                }}
              >
                <span style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "4px",
                  background: `color-mix(in srgb, ${color} 15%, transparent)`,
                  color,
                  border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  flexShrink: 0,
                  lineHeight: "18px",
                }}>
                  {SEVERITY_LABEL[severity]}
                </span>
                <span style={{
                  fontSize: "12px",
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}>
                  {b.reason}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
