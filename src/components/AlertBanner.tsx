import { useDataState } from "../store";

export function AlertBanner() {
  const { blockers } = useDataState();
  if (blockers.length === 0) return null;

  const latest = blockers.length > 0 ? blockers[blockers.length - 1] : null;
  const extra = blockers.length - 1;

  return (
    <div
      role="alert"
      style={{
        background: "var(--yellow-bg)",
        borderTop: "1px solid var(--status-warning)",
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
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
    </div>
  );
}
