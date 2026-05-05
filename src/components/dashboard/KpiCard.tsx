import { memo } from "react";
import { MetricInfoTip } from "../ui/MetricInfoTip";

export const KpiCard = memo(function KpiCard({ label, value, color, tooltip }: { label: string; value: string; color: string; tooltip?: string }) {
  return (
    <div style={{
      background: "var(--bg-secondary)", border: "1px solid var(--border)",
      borderRadius: "8px", padding: "12px", textAlign: "center",
    }}>
      <div style={{ fontSize: "24px", fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", letterSpacing: "0.05em", marginTop: "4px", display: "flex", alignItems: "center", justifyContent: "center", gap: "2px" }}>
        {label}
        {tooltip && <MetricInfoTip text={tooltip} />}
      </div>
    </div>
  );
});

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
