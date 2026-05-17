import { useCallback, useEffect, useState } from "react";
import { useApi } from "../hooks/useApi";
import type { ScoredMatch } from "../../shared/types.js";

// ─── Score → severity ─────────────────────────────────────────────────────────

function severityColor(score: number): string {
  if (score >= 90) return "var(--accent-red, #dc2626)";
  if (score >= 75) return "var(--accent-orange, #ea580c)";
  if (score >= 60) return "var(--accent-yellow, #eab308)";
  return "var(--text-muted)";
}

function severityBg(score: number): string {
  if (score >= 90) return "rgba(220, 38, 38, 0.12)";
  if (score >= 75) return "rgba(234, 88, 12, 0.12)";
  if (score >= 60) return "rgba(234, 179, 8, 0.12)";
  return "rgba(128, 128, 128, 0.08)";
}

function severityLabel(score: number): string {
  if (score >= 90) return "Critical";
  if (score >= 75) return "High";
  if (score >= 60) return "Medium";
  return "Low";
}

function entityIcon(entityType: ScoredMatch["entityType"]): string {
  switch (entityType) {
    case "blocker":   return "⊘";
    case "agent":     return "◉";
    case "review":    return "✗";
    case "task":      return "□";
    case "commit":    return "◇";
    case "milestone": return "⤳";
    case "area":      return "⚡";
    default:          return "·";
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
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDetectorMatches();
      setMatches(data);
      setLastRefresh(new Date());
    } catch (e) {
      // Keep stale data visible; show error as a banner overlay.
      setError(e instanceof Error ? e.message : "Failed to load anomalies");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void fetchMatches(); }, [fetchMatches]);

  const criticalCount = matches.filter((m) => m.score >= 90).length;
  const highCount = matches.filter((m) => m.score >= 75 && m.score < 90).length;
  const initialLoad = loading && matches.length === 0;

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
              background: severityBg(95),
              padding: "2px 8px", borderRadius: "12px",
            }}>
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span style={{
              fontSize: "11px", fontWeight: 600,
              color: "var(--accent-orange, #ea580c)",
              background: severityBg(80),
              padding: "2px 8px", borderRadius: "12px",
            }}>
              {highCount} high
            </span>
          )}
          <button
            onClick={() => void fetchMatches()}
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

      {/* Error banner — shown above stale data when a refresh fails */}
      {error && (
        <div style={{
          color: "var(--accent-red, #dc2626)",
          background: severityBg(95),
          border: "1px solid var(--accent-red, #dc2626)",
          borderRadius: "4px",
          fontSize: "12px",
          padding: "8px 12px",
          marginBottom: "12px",
        }}>
          {error}
        </div>
      )}

      {/* Body */}
      {initialLoad ? (
        <div style={{ color: "var(--text-muted)", fontSize: "13px", padding: "40px 0", textAlign: "center" }}>
          Loading anomalies…
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
      {!initialLoad && matches.length > 0 && lastRefresh && (
        <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", textAlign: "right" }}>
          {matches.length} anomal{matches.length === 1 ? "y" : "ies"} ·{" "}
          refreshed {lastRefresh.toLocaleTimeString()}
          {loading && " · refreshing…"}
        </div>
      )}
    </div>
  );
}
