import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import type { ScoredMatch } from "../../shared/types";

// ─── Score → severity color ────────────────────────────────────────────────────

function severityColor(score: number): string {
  if (score >= 90) return "var(--accent-red, #dc2626)";
  if (score >= 75) return "var(--accent-orange, #ea580c)";
  if (score >= 60) return "var(--accent-yellow, #eab308)";
  return "var(--text-muted)";
}

function severityLabel(score: number): string {
  if (score >= 90) return "Critical";
  if (score >= 75) return "High";
  if (score >= 60) return "Medium";
  return "Low";
}

// ─── Entity type icon (text-based, no icon lib dependency) ────────────────────

function entityIcon(entityType: ScoredMatch["entityType"]): string {
  switch (entityType) {
    case "blocker":  return "⊘";
    case "agent":    return "◉";
    case "review":   return "✗";
    case "task":     return "□";
  }
}

// ─── Single anomaly row ───────────────────────────────────────────────────────

function AnomalyRow({ match }: { match: ScoredMatch }) {
  const color = severityColor(match.score);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px 1fr auto",
        gap: "10px",
        alignItems: "center",
        padding: "10px 12px",
        borderRadius: "6px",
        background: "var(--bg-secondary)",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <span style={{ fontSize: "18px", color, textAlign: "center", userSelect: "none" }}>
        {entityIcon(match.entityType)}
      </span>
      <div>
        <div style={{ fontWeight: 500, color: "var(--text-primary)", fontSize: "13px" }}>
          {match.label}
        </div>
        {match.detail && (
          <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
            {match.detail}
          </div>
        )}
        <div style={{ color: "var(--text-muted)", fontSize: "11px", marginTop: "2px" }}>
          {match.category} · {match.detectorId}
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: "60px" }}>
        <div style={{ fontWeight: 700, fontSize: "20px", color, lineHeight: 1 }}>
          {match.score}
        </div>
        <div style={{ fontSize: "10px", color, fontWeight: 500 }}>
          {severityLabel(match.score)}
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function HotSpotsView() {
  const api = useApi();
  const [matches, setMatches] = useState<ScoredMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  async function fetchMatches() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDetectorMatches();
      setMatches(data);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load anomalies");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchMatches(); }, []);

  const criticalCount = matches.filter((m) => m.score >= 90).length;
  const highCount = matches.filter((m) => m.score >= 75 && m.score < 90).length;

  return (
    <div style={{ padding: "16px 20px", maxWidth: "800px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>
            Hot Spots
          </h2>
          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>
            Top anomalies across all projects · sorted by severity
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {criticalCount > 0 && (
            <span style={{
              fontSize: "11px", fontWeight: 600,
              color: "var(--accent-red, #dc2626)",
              background: "color-mix(in srgb, var(--accent-red, #dc2626) 12%, transparent)",
              padding: "2px 8px", borderRadius: "12px",
            }}>
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span style={{
              fontSize: "11px", fontWeight: 600,
              color: "var(--accent-orange, #ea580c)",
              background: "color-mix(in srgb, var(--accent-orange, #ea580c) 12%, transparent)",
              padding: "2px 8px", borderRadius: "12px",
            }}>
              {highCount} high
            </span>
          )}
          <button
            onClick={fetchMatches}
            disabled={loading}
            style={{
              fontSize: "12px", padding: "4px 10px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              color: "var(--text-muted)",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading && matches.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "40px 0", textAlign: "center" }}>
          Loading anomalies…
        </div>
      ) : error ? (
        <div style={{ color: "var(--accent-red, #dc2626)", fontSize: "13px", padding: "16px 0" }}>
          {error}
        </div>
      ) : matches.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "60px 20px",
          color: "var(--text-muted)", fontSize: "14px",
        }}>
          <div style={{ fontSize: "32px", marginBottom: "12px" }}>✓</div>
          <div style={{ fontWeight: 600, marginBottom: "4px" }}>All clear</div>
          <div style={{ fontSize: "12px" }}>No anomalies detected above threshold</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {matches.map((m) => (
            <AnomalyRow key={`${m.detectorId}-${m.entityId}`} match={m} />
          ))}
        </div>
      )}

      {/* Footer */}
      {!loading && !error && matches.length > 0 && (
        <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", textAlign: "right" }}>
          {matches.length} anomal{matches.length === 1 ? "y" : "ies"} ·{" "}
          refreshed {lastRefresh.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
