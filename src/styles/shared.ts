import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Type scale — spread into React inline styles
// ---------------------------------------------------------------------------
export const typeScale = {
  display: { fontSize: "32px", fontWeight: 600, lineHeight: 1.2 } as CSSProperties,
  h1:      { fontSize: "24px", fontWeight: 600, lineHeight: 1.3 } as CSSProperties,
  h2:      { fontSize: "18px", fontWeight: 600, lineHeight: 1.4 } as CSSProperties,
  body:    { fontSize: "14px", fontWeight: 400, lineHeight: 1.5 } as CSSProperties,
  caption: { fontSize: "12px", fontWeight: 400, lineHeight: 1.4 } as CSSProperties,
  micro:   {
    fontSize: "11px",
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  } as CSSProperties,
};

// ---------------------------------------------------------------------------
// Shared component styles
// ---------------------------------------------------------------------------
export const cardStyle: CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "var(--space-4)",
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
  padding: "var(--space-2) var(--space-3)",
  fontSize: "13px",
};

export const sectionHeader: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "var(--text-muted)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: "var(--space-2)",
};

export const buttonPrimary: CSSProperties = {
  background: "var(--accent-blue)",
  border: "none",
  color: "var(--text-on-accent)",
  borderRadius: "6px",
  padding: "var(--space-2) var(--space-4)",
  fontSize: "13px",
  cursor: "pointer",
};

export const buttonSecondary: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text-secondary)",
  borderRadius: "6px",
  padding: "var(--space-2) var(--space-4)",
  fontSize: "13px",
  cursor: "pointer",
};

export const emptyState: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "13px",
  textAlign: "center",
  padding: "var(--space-7)",
};
