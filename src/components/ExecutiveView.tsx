import { useEffect, useState, useCallback } from "react";
import { useDataState, useNavigationState } from "../store";
import { useApi } from "../hooks/useApi";
import { typeScale } from "../styles/shared.js";
import type { ExecutiveSummary } from "../../shared/types.js";

const HEALTH_COLOR: Record<string, string> = {
  on_track: "var(--accent-green)",
  at_risk: "var(--accent-yellow)",
  behind: "var(--accent-red)",
};

const HEALTH_LABEL: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  behind: "Behind",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--bg-secondary)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      padding: "18px 20px",
    }}>
      <h3 style={{ ...typeScale.micro, color: "var(--text-muted)", margin: "0 0 var(--space-3) 0" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function BigStat({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "28px", fontWeight: 700, color: color ?? "var(--text-primary)", lineHeight: 1 }}>{value}</div>
      <div style={{ ...typeScale.caption, color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{label}</div>
    </div>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ background: "var(--bg-tertiary)", borderRadius: "3px", height: "6px", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color, borderRadius: "3px", transition: "width 0.3s ease" }} />
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; cost_usd: number }[] }) {
  if (data.length < 2) {
    return <div style={{ height: "40px", display: "flex", alignItems: "center", color: "var(--text-muted)", fontSize: "11px" }}>No trend data</div>;
  }
  const max = Math.max(...data.map((d) => d.cost_usd), 0.001);
  const w = 200, h = 40;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.cost_usd / max) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-label="7-day cost trend sparkline">
      <polyline points={pts} fill="none" stroke="var(--accent-blue, #6366f1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MilestoneHealthCard({ health }: { health: ExecutiveSummary["milestone_health"] }) {
  if (health.length === 0) {
    return <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>No open milestones</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {health.map((m) => (
        <div key={m.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "5px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 500 }}>{m.name}</span>
            <span style={{
              fontSize: "11px",
              fontWeight: 600,
              padding: "2px 7px",
              borderRadius: "9px",
              color: HEALTH_COLOR[m.health],
              background: `color-mix(in srgb, ${HEALTH_COLOR[m.health]} 12%, transparent)`,
            }}>
              {HEALTH_LABEL[m.health]}
            </span>
          </div>
          <ProgressBar pct={m.completion_pct} color={HEALTH_COLOR[m.health]} />
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
            {m.completed_count}/{m.task_count} tasks · {m.completion_pct}%
            {m.target_date && ` · Due ${new Date(m.target_date).toLocaleDateString()}`}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ExecutiveView() {
  const { selectedProjectId } = useNavigationState();
  const { projects } = useDataState();
  const api = useApi();
  const [summary, setSummary] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localProjectId, setLocalProjectId] = useState<string | null>(selectedProjectId);

  const projectId = localProjectId ?? projects[0]?.id ?? null;

  const load = useCallback(async (pid: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getExecutiveSummary(pid);
      setSummary(data);
    } catch {
      setError("Failed to load executive summary");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (projectId) load(projectId);
  }, [projectId, load]);

  function handleExport() {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `executive-summary-${summary.project_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <h2 style={{ ...typeScale.h2, color: "var(--text-primary)", margin: 0 }}>
            Executive Summary
          </h2>
          {projects.length > 1 && (
            <select
              value={projectId ?? ""}
              onChange={(e) => setLocalProjectId(e.target.value)}
              style={{ fontSize: "13px", background: "var(--bg-tertiary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "5px", padding: "4px 8px" }}
              aria-label="Select project"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {summary && (
            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
              Generated {new Date(summary.generated_at).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => projectId && load(projectId)}
            disabled={loading}
            style={{ padding: "6px 12px", borderRadius: "5px", border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", cursor: loading ? "default" : "pointer" }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            onClick={handleExport}
            disabled={!summary}
            style={{ padding: "6px 12px", borderRadius: "5px", border: "1px solid var(--border)", background: "var(--bg-tertiary)", color: "var(--text-secondary)", fontSize: "12px", cursor: summary ? "pointer" : "default" }}
          >
            Export JSON
          </button>
        </div>
      </div>

      {!projectId && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>No project selected.</div>
      )}

      {error && (
        <div style={{ color: "var(--accent-red)", fontSize: "13px", marginBottom: "12px" }}>{error}</div>
      )}

      {loading && !summary && (
        <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading summary…</div>
      )}

      {summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px" }}>

          {/* Milestone Health */}
          <div style={{ gridColumn: "1 / -1" }}>
            <Card title="Milestone Health">
              <MilestoneHealthCard health={summary.milestone_health} />
            </Card>
          </div>

          {/* Team Utilization */}
          <Card title="Team Utilization">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              <BigStat value={summary.team_utilization.active} label="Active" color="var(--accent-green)" />
              <BigStat value={summary.team_utilization.idle} label="Idle" color="var(--accent-yellow)" />
              <BigStat value={summary.team_utilization.offline} label="Offline" color="var(--text-muted)" />
            </div>
            <div style={{ marginTop: "12px" }}>
              <ProgressBar
                pct={summary.team_utilization.total > 0 ? (summary.team_utilization.active / summary.team_utilization.total) * 100 : 0}
                color="var(--accent-green)"
              />
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "3px" }}>
                {summary.team_utilization.total} total agents
              </div>
            </div>
          </Card>

          {/* Blockers */}
          <Card title="Blockers">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <BigStat
                value={summary.blockers.open_count}
                label="Open blockers"
                color={summary.blockers.open_count > 0 ? "var(--accent-red)" : "var(--accent-green)"}
              />
              <BigStat
                value={summary.blockers.avg_resolution_seconds != null
                  ? `${Math.round(summary.blockers.avg_resolution_seconds / 3600)}h`
                  : "—"}
                label="Avg resolution"
              />
            </div>
          </Card>

          {/* Velocity */}
          <Card title="Task Velocity">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <BigStat value={summary.velocity.this_week} label="This week" color="var(--accent-green)" />
              <BigStat value={summary.velocity.last_week} label="Last week" />
              <BigStat
                value={summary.velocity.trend_pct != null ? `${summary.velocity.trend_pct > 0 ? "+" : ""}${summary.velocity.trend_pct}%` : "—"}
                label="Trend"
                color={summary.velocity.trend_pct != null && summary.velocity.trend_pct >= 0 ? "var(--accent-green)" : "var(--accent-red)"}
              />
            </div>
          </Card>

          {/* Cost Overview */}
          <Card title="Cost Overview">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
              <BigStat value={`$${summary.costs.total_cost_usd.toFixed(2)}`} label="Total spend" />
              <BigStat value={`$${summary.costs.last_7_days_cost_usd.toFixed(2)}`} label="Last 7 days" />
            </div>
            <Sparkline data={summary.costs.daily_trend} />
          </Card>

        </div>
      )}
    </div>
  );
}
