import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import type { Blocker, Task } from "../../types";

interface BlockersCardProps {
  blockers: Blocker[];
}

export const BlockersCard = memo(function BlockersCard({ blockers }: BlockersCardProps) {
  return (
    <CardWrapper title={`Active Blockers (${blockers.length})`}>
      {blockers.length === 0 ? (
        <div style={{ color: "var(--status-success)", fontSize: "12px" }}>No active blockers</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {blockers.slice(0, 10).map((b) => (
            <div key={b.id} style={{ fontSize: "12px", color: "var(--status-warning)" }}>
              {b.reason}
            </div>
          ))}
        </div>
      )}
    </CardWrapper>
  );
});

interface OverdueTasksCardProps {
  tasks: Task[];
}

export const OverdueTasksCard = memo(function OverdueTasksCard({ tasks }: OverdueTasksCardProps) {
  return (
    <CardWrapper title={`Overdue Tasks (${tasks.length})`}>
      {tasks.length === 0 ? (
        <div style={{ color: "var(--status-success)", fontSize: "12px" }}>No overdue tasks</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {tasks.slice(0, 10).map((t) => (
            <div key={t.id} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-primary)" }}>{t.title}</span>
              <span style={{ color: "var(--status-danger)", fontSize: "10px" }}>{t.due_date}</span>
            </div>
          ))}
        </div>
      )}
    </CardWrapper>
  );
});
