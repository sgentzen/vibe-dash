interface StatPillProps {
  label: string;
  value: number;
  color: string;
}

export function StatPill({ label, value, color }: StatPillProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <span style={{ color, fontSize: "20px", fontWeight: 700, fontFamily: "monospace" }}>
        {value}
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: "10px", letterSpacing: "0.05em" }}>
        {label}
      </span>
    </div>
  );
}
