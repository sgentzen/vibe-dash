import type { CSSProperties } from "react";

export function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: "var(--bg-secondary)", border: "1px solid var(--border)",
      borderRadius: "8px", padding: "12px", textAlign: "center",
    }}>
      <div style={{ fontSize: "24px", fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.05em", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
