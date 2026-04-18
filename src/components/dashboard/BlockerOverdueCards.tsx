import { cardStyle, sectionHeader } from "../../styles/shared.js";
import type { Blocker, Task } from "../../types";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

interface BlockersCardProps {
  blockers: Blocker[];
}

export function BlockersCard({ blockers }: BlockersCardProps) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Active Blockers ({blockers.length})</div>
      {blockers.length === 0 ? (
        <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No active blockers</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {blockers.slice(0, 10).map((b) => (
            <div key={b.id} style={{ fontSize: "12px", color: "var(--accent-yellow)" }}>
              {b.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface OverdueTasksCardProps {
  tasks: Task[];
}

export function OverdueTasksCard({ tasks }: OverdueTasksCardProps) {
  return (
    <div style={cardStyle}>
      <div style={headerStyle}>Overdue Tasks ({tasks.length})</div>
      {tasks.length === 0 ? (
        <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No overdue tasks</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {tasks.slice(0, 10).map((t) => (
            <div key={t.id} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-primary)" }}>{t.title}</span>
              <span style={{ color: "var(--accent-red)", fontSize: "10px" }}>{t.due_date}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
