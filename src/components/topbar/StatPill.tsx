import { microLabel, pillStyle } from "../../styles/shared.js";

interface StatPillProps {
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}

export function StatPill({ label, value, color, onClick }: Readonly<StatPillProps>) {
  const inner = (
    <>
      <span style={{ color, fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
        {value}
      </span>
      <span style={microLabel}>
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
          ...pillStyle(),
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "4px 6px",
          borderRadius: "6px",
        }}
        onMouseEnter={(e) => { (e.currentTarget).style.background = "var(--bg-tertiary)"; }}
        onMouseLeave={(e) => { (e.currentTarget).style.background = "transparent"; }}
      >
        {inner}
      </button>
    );
  }

  return (
    <div style={pillStyle()}>
      {inner}
    </div>
  );
}
