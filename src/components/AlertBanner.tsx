import { useAppState } from "../store";

export function AlertBanner() {
  const { blockers, fileConflicts } = useAppState();
  if (blockers.length === 0 && fileConflicts.length === 0) return null;

  const latest = blockers.length > 0 ? blockers[blockers.length - 1] : null;
  const extra = blockers.length - 1;

  return (
    <div
      role="alert"
      style={{
        background: "var(--yellow-bg)",
        borderTop: "1px solid var(--accent-yellow)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          color: "var(--accent-yellow)",
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
            color: "var(--accent-yellow)",
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
            color: "var(--accent-red)",
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
