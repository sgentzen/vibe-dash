import { memo } from "react";
import { CardWrapper } from "../ui/Card";
import { EmptyState } from "../EmptyState.js";
import { typeScale } from "../../styles/shared.js";
import type { Blocker, Task } from "../../types";

interface BlockersCardProps {
  blockers: Blocker[];
}

export const BlockersCard = memo(function BlockersCard({ blockers }: BlockersCardProps) {
  return (
    <CardWrapper title={`Active Blockers (${blockers.length})`}>
      {blockers.length === 0 ? (
        <EmptyState compact icon="✓" message="No active blockers" color="var(--status-success)" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {blockers.slice(0, 10).map((b) => (
            <div
              key={b.id}
              style={{
                ...typeScale.caption,
                color: "var(--status-warning)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={b.reason}
            >
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
        <EmptyState compact icon="✓" message="No overdue tasks" color="var(--status-success)" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {tasks.slice(0, 10).map((t) => (
            <div key={t.id} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
              <span
                style={{
                  color: "var(--text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "70%",
                  minWidth: 0,
                }}
                title={t.title}
              >
                {t.title}
              </span>
              <span style={{ color: "var(--status-danger)", fontSize: "10px" }}>{t.due_date}</span>
            </div>
          ))}
        </div>
      )}
    </CardWrapper>
  );
});
