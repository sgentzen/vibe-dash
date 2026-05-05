import type { ReactNode } from "react";

interface EmptyStateProps {
  message: string;
  compact?: boolean;
  icon?: ReactNode;
  color?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ message, compact = false, icon, color = "var(--text-muted)", action }: EmptyStateProps) {
  if (compact) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "6px", height: "32px", fontSize: "12px", color }}>
        {icon && <span style={{ lineHeight: 1, flexShrink: 0 }}>{icon}</span>}
        {message}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "24px 16px",
      gap: "8px",
    }}>
      {icon && <span style={{ fontSize: "20px", lineHeight: 1 }}>{icon}</span>}
      <span style={{ fontSize: "13px", color }}>{message}</span>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: "4px",
            background: "var(--accent-blue)",
            border: "none",
            color: "var(--text-on-accent)",
            borderRadius: "6px",
            padding: "6px 14px",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
