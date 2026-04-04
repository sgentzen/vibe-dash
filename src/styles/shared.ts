import type { CSSProperties } from "react";

export const cardStyle: CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "16px",
};

export function badgeStyle(color: string): CSSProperties {
  return {
    fontSize: "10px",
    padding: "1px 6px",
    borderRadius: "4px",
    background: `${color}15`,
    color,
    border: `1px solid ${color}40`,
    whiteSpace: "nowrap",
  };
}

export const inputStyle: CSSProperties = {
  width: "100%",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  color: "var(--text-primary)",
  padding: "7px 10px",
  fontSize: "13px",
};

export const sectionHeader: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--text-muted)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: "10px",
};

export const buttonPrimary: CSSProperties = {
  background: "var(--accent-blue)",
  border: "none",
  color: "var(--text-on-accent)",
  borderRadius: "6px",
  padding: "8px 16px",
  fontSize: "13px",
  cursor: "pointer",
};

export const buttonSecondary: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  borderRadius: "6px",
  padding: "8px 16px",
  fontSize: "13px",
  cursor: "pointer",
};

export const emptyState: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "13px",
  textAlign: "center",
  padding: "40px",
};
