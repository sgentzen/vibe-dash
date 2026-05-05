import { typeScale } from "../../styles/shared.js";

interface StatPillProps {
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}

export function StatPill({ label, value, color, onClick }: StatPillProps) {
  const inner = (
    <>
      <span style={{ color, fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
        {value}
      </span>
      <span style={{ ...typeScale.micro, color: "var(--text-muted)" }}>
        {label}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        aria-label={`View ${label.toLowerCase()}`}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          lineHeight: 1,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "4px 6px",
          borderRadius: "6px",
          gap: "2px",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-tertiary)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      {inner}
    </div>
  );
}
