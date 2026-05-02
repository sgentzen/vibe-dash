import type { StatusToken } from "../constants/statusTokens.js";
import { tokenToColor } from "../constants/statusTokens.js";

const ICON: Record<StatusToken, string> = {
  success: "✓",
  warning: "⚠",
  danger: "✗",
  info: "●",
  neutral: "○",
};

interface StatusPillProps {
  token: StatusToken;
  label: string;
  size?: "sm" | "md";
}

export function StatusPill({ token, label, size = "sm" }: StatusPillProps) {
  const color = tokenToColor(token);
  const fontSize = size === "md" ? "12px" : "10px";
  const iconSize = size === "md" ? "10px" : "9px";

  return (
    <span
      style={{
        fontSize,
        padding: "1px 6px",
        borderRadius: "4px",
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
        display: "inline-flex",
        alignItems: "center",
        gap: "3px",
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: iconSize }}>{ICON[token]}</span>
      {label}
    </span>
  );
}
