interface TaskDrawerHeaderProps {
  onClose: () => void;
}

export function TaskDrawerHeader({ onClose }: TaskDrawerHeaderProps) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span
        style={{
          color: "var(--text-secondary)",
          fontSize: "11px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Edit Task
      </span>
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: "18px",
          cursor: "pointer",
          lineHeight: 1,
          padding: "0 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}
