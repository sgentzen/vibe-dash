import type { CSSProperties } from "react";

export const viewBtnStyle: CSSProperties = {
  border: "none",
  borderRadius: "4px",
  padding: "4px 10px",
  fontSize: "12px",
  cursor: "pointer",
  fontWeight: 500,
};

export function btnStyle(bg: string): CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${bg}`,
    color: bg,
    borderRadius: "6px",
    padding: "4px 12px",
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
