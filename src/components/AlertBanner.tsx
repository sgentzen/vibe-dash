import { useDataState, useNotificationState } from "../store";

export function AlertBanner() {
  const { blockers } = useDataState();
  const { fileConflicts } = useNotificationState();
  if (blockers.length === 0 && fileConflicts.length === 0) return null;

  const latest = blockers.length > 0 ? blockers[blockers.length - 1] : null;
  const extra = blockers.length - 1;

  return (
    <div
      role="alert"
      style={{
        background: "var(--yellow-bg)",
        borderTop: "1px solid var(--status-warning)",
        padding: "var(--space-2) var(--space-4)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: "var(--status-warning)",
          fontWeight: 700,
          fontSize: "12px",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}
      >
        ⚠ ALERT
      </span>
      {latest && (
        <span
          style={{
            color: "var(--text-primary)",
            fontSize: "13px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {latest.reason}
        </span>
      )}
      {extra > 0 && (
        <span
          style={{
            color: "var(--status-warning)",
            fontSize: "12px",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          +{extra} more
        </span>
      )}
      {fileConflicts.map((c) => (
        <span
          key={c.file_path}
          style={{
            color: "var(--status-danger)",
            fontSize: "12px",
            whiteSpace: "nowrap",
          }}
        >
          {c.agents.map((a) => a.agent_name).join(" & ")} both editing {c.file_path}
        </span>
      ))}
    </div>
  );
}
