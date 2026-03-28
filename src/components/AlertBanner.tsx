import { useAppState } from "../store";

export function AlertBanner() {
  const { blockers } = useAppState();
  if (blockers.length === 0) return null;

  const latest = blockers[blockers.length - 1];
  const extra = blockers.length - 1;

  return (
    <div
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
    </div>
  );
}
