import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader } from "../styles/shared.js";
import type { SprintDailyStats, VelocityData, ActivityHeatmapEntry, AgentContribution } from "../types";

export function DashboardView() {
  const { projects, sprints, blockers, tasks, selectedProjectId, pollGeneration } = useAppState();
  const api = useApi();

  const [burndown, setBurndown] = useState<SprintDailyStats[]>([]);
  const [velocity, setVelocity] = useState<VelocityData[]>([]);
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"day" | "week" | "sprint">("week");
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);

  // Project-scoped data
  const projectId = selectedProjectId || projects[0]?.id;
  const projectSprints = sprints.filter((s) => !projectId || s.project_id === projectId);
  const projectTasks = tasks.filter((t) => !projectId || t.project_id === projectId);
  const projectTaskIds = new Set(projectTasks.map((t) => t.id));
  const projectBlockers = blockers.filter((b) => !projectId || projectTaskIds.has(b.task_id));

  const activeSprint = projectSprints.find((s) => s.status === "active");
  const overdueTasks = projectTasks.filter(
    (t) => t.due_date && t.status !== "done" && new Date(t.due_date) < new Date()
  );
  const unresolvedBlockers = projectBlockers.filter((b) => !b.resolved_at);
  const doneTaskCount = projectTasks.filter((t) => t.status === "done").length;

  // Track task status changes for the active sprint to trigger dashboard refreshes
  const sprintTaskStatusKey = activeSprint
    ? projectTasks.filter((t) => t.sprint_id === activeSprint.id).map((t) => `${t.id}:${t.status}`).join(",")
    : "";

  // Dashboard charts: refresh on sprint task status changes + polling
  useEffect(() => {
    async function load() {
      try {
        const [vel, heat] = await Promise.all([
          api.getVelocityTrend(5, projectId),
          api.getActivityHeatmap(projectId),
        ]);
        setVelocity(vel);
        setHeatmap(heat);

        if (activeSprint) {
          const [bd, contrib] = await Promise.all([
            api.getSprintBurndown(activeSprint.id),
            api.getSprintContributions(activeSprint.id),
          ]);
          setBurndown(bd);
          setContributions(contrib);
        }
      } catch (e) {
        console.warn("[DashboardView] failed to load chart data", e);
      }
    }
    load();
  }, [api, activeSprint?.id, projectId, sprintTaskStatusKey, pollGeneration]);

  // Cost data: refresh on project change or sprint task status changes (not every poll tick)
  useEffect(() => {
    if (!projectId) return;
    async function loadCosts() {
      try {
        const [summary, ts, byModel, byAgent] = await Promise.all([
          api.getProjectCostSummary(projectId!),
          api.getCostTimeseries({ project_id: projectId!, days: "30" }),
          api.getCostByModel({ project_id: projectId! }),
          api.getCostByAgent({ project_id: projectId! }),
        ]);
        setCostSummary(summary);
        setCostTimeseries(ts);
        setCostByModel(byModel);
        setCostByAgent(byAgent);
      } catch (e) {
        console.warn("[DashboardView] failed to load cost data", e);
      }
    }
    loadCosts();
  }, [api, projectId, sprintTaskStatusKey, pollGeneration]);

  async function handleGenerateReport() {
    if (!projectId) return;
    try {
      const report = await api.generateReport(projectId, reportPeriod);
      setReportText(report);
    } catch {
      setReportText("Failed to generate report.");
    }
  }

  const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

  return (
    <div style={{ flex: 1, padding: "16px", overflowY: "auto" }}>
      <h2 style={{ color: "var(--text-primary)", fontSize: "16px", marginBottom: "16px", fontWeight: 600 }}>
        Dashboard
      </h2>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <KpiCard label="Active Sprint" value={activeSprint?.name ?? "None"} color="var(--accent-blue)" />
        <KpiCard label="Overdue Tasks" value={String(overdueTasks.length)} color={overdueTasks.length > 0 ? "var(--accent-red)" : "var(--accent-green)"} />
        <KpiCard label="Active Blockers" value={String(unresolvedBlockers.length)} color={unresolvedBlockers.length > 0 ? "var(--accent-yellow)" : "var(--accent-green)"} />
        <KpiCard label="Active Tasks" value={String(projectTasks.filter((t) => t.status !== "done").length)} color="var(--text-secondary)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Burndown */}
        <div style={cardStyle}>
          <div style={headerStyle}>Sprint Burndown {activeSprint ? `(${activeSprint.name})` : ""}</div>
          {burndown.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              {activeSprint ? "No burndown data yet. Complete tasks to see progress." : "No active sprint — create and activate a sprint to see burndown."}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
              {burndown.map((d) => {
                const total = d.completed_tasks + d.remaining_tasks;
                const pct = total > 0 ? (d.remaining_tasks / total) * 100 : 0;
                return (
                  <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                      height: `${pct}%`, minHeight: "2px",
                    }} />
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px" }}>
                      {d.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Velocity */}
        <div style={cardStyle}>
          <div style={headerStyle}>Velocity Trend (Last {velocity.length} Sprints)</div>
          {velocity.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>Complete at least one sprint to see velocity trends.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px" }}>
              {(() => { const maxPts = Math.max(...velocity.map((x) => x.completed_points), 1); return velocity.map((v) => {
                const pct = (v.completed_points / maxPts) * 100;
                return (
                  <div key={v.sprint_id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <span style={{ fontSize: "10px", color: "var(--accent-green)", fontWeight: 600 }}>{v.completed_points}pt</span>
                    <div style={{
                      width: "100%", background: "var(--accent-green)", borderRadius: "2px",
                      height: `${pct}%`, minHeight: "2px", marginTop: "4px",
                    }} />
                    <span style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "4px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: "60px" }}>
                      {v.sprint_name}
                    </span>
                  </div>
                );
              }); })()}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Agent Contributions */}
        <div style={cardStyle}>
          <div style={headerStyle}>Agent Contributions {activeSprint ? `(${activeSprint.name})` : ""}</div>
          {contributions.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              {activeSprint ? "No contributions yet." : "No active sprint — activate a sprint to track agent contributions."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {contributions.map((c) => (
                <div key={c.agent_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{c.agent_name}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {c.completed_count} tasks ({c.completed_points}pt)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Heatmap */}
        <div style={cardStyle}>
          <div style={headerStyle}>Activity Heatmap (by hour)</div>
          {heatmap.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No activity data yet.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px" }}>
              {(() => {
                const hourTotals = Array.from({ length: 24 }, (_, h) =>
                  heatmap.filter((e) => e.hour === h).reduce((sum, e) => sum + e.count, 0)
                );
                const maxTotal = Math.max(...hourTotals, 1);
                return Array.from({ length: 24 }, (_, h) => {
                const total = hourTotals[h];
                const intensity = total / maxTotal;
                return (
                  <div
                    key={h}
                    title={`${h}:00 - ${total} activities`}
                    style={{
                      width: "20px", height: "20px", borderRadius: "3px",
                      background: total === 0 ? "var(--bg-tertiary)" : `rgba(99, 102, 241, ${0.2 + intensity * 0.8})`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "8px", color: intensity > 0.5 ? "var(--text-on-accent)" : "var(--text-muted)",
                    }}
                  >
                    {h}
                  </div>
                );
              }); })()}
            </div>
          )}
        </div>
      </div>

      {/* Blockers + Overdue */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        <div style={cardStyle}>
          <div style={headerStyle}>Active Blockers ({unresolvedBlockers.length})</div>
          {unresolvedBlockers.length === 0 ? (
            <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No active blockers</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {unresolvedBlockers.slice(0, 10).map((b) => (
                <div key={b.id} style={{ fontSize: "12px", color: "var(--accent-yellow)" }}>
                  {b.reason}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={headerStyle}>Overdue Tasks ({overdueTasks.length})</div>
          {overdueTasks.length === 0 ? (
            <div style={{ color: "var(--accent-green)", fontSize: "12px" }}>No overdue tasks</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              {overdueTasks.slice(0, 10).map((t) => (
                <div key={t.id} style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-primary)" }}>{t.title}</span>
                  <span style={{ color: "var(--accent-red)", fontSize: "10px" }}>{t.due_date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cost & Token Tracking */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <KpiCard label="Total Spend" value={costSummary ? `$${costSummary.total_cost_usd.toFixed(2)}` : "$0.00"} color="var(--accent-blue)" />
        <KpiCard label="Input Tokens" value={costSummary ? formatTokens(costSummary.total_input_tokens) : "0"} color="var(--text-secondary)" />
        <KpiCard label="Output Tokens" value={costSummary ? formatTokens(costSummary.total_output_tokens) : "0"} color="var(--text-secondary)" />
        <KpiCard
          label="Avg Cost/Task"
          value={costSummary && doneTaskCount > 0
            ? `$${(costSummary.total_cost_usd / doneTaskCount).toFixed(3)}`
            : "$0.00"}
          color="var(--accent-green)"
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Cost Timeseries */}
        <div style={cardStyle}>
          <div style={headerStyle}>Daily Spend (Last 30 Days)</div>
          {costTimeseries.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No cost data yet. Agents will log costs as they work.</div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "120px" }}>
              {(() => { const maxCost = Math.max(...costTimeseries.map((x) => x.total_cost_usd), 0.01); return costTimeseries.map((d) => {
                const pct = (d.total_cost_usd / maxCost) * 100;
                return (
                  <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: "100%", background: "var(--accent-blue)", borderRadius: "2px",
                      height: `${pct}%`, minHeight: "2px",
                    }} title={`${d.date}: $${d.total_cost_usd.toFixed(4)}`} />
                    <span style={{ fontSize: "8px", color: "var(--text-muted)", marginTop: "2px" }}>
                      {d.date.slice(8)}
                    </span>
                  </div>
                );
              }); })()}
            </div>
          )}
        </div>

        {/* Cost by Model */}
        <div style={cardStyle}>
          <div style={headerStyle}>Cost by Model</div>
          {costByModel.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No model cost data yet.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {(() => { const maxCost = Math.max(...costByModel.map((x) => x.total_cost_usd), 0.01); return costByModel.map((m) => {
                const pct = (m.total_cost_usd / maxCost) * 100;
                return (
                  <div key={`${m.model}-${m.provider}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: "var(--text-primary)" }}>{m.model}</span>
                      <span style={{ color: "var(--text-muted)" }}>${m.total_cost_usd.toFixed(4)} ({formatTokens(m.total_tokens)} tok)</span>
                    </div>
                    <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-purple)", borderRadius: "2px" }} />
                    </div>
                  </div>
                );
              }); })()}
            </div>
          )}
        </div>
      </div>

      {/* Cost by Agent */}
      {costByAgent.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={headerStyle}>Cost by Agent</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {(() => { const maxCost = Math.max(...costByAgent.map((x) => x.total_cost_usd), 0.01); return costByAgent.map((a) => {
              const pct = (a.total_cost_usd / maxCost) * 100;
              return (
                <div key={a.agent_id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                    <span style={{ color: "var(--text-primary)" }}>{a.agent_name}</span>
                    <span style={{ color: "var(--text-muted)" }}>${a.total_cost_usd.toFixed(4)} ({formatTokens(a.total_tokens)} tok)</span>
                  </div>
                  <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-green)", borderRadius: "2px" }} />
                  </div>
                </div>
              );
            }); })()}
          </div>
        </div>
      )}

      {/* Report Generation */}
      <div style={cardStyle}>
        <div style={headerStyle}>Generate Status Report</div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "12px" }}>
          <select
            value={reportPeriod}
            onChange={(e) => setReportPeriod(e.target.value as "day" | "week" | "sprint")}
            style={{
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: "4px", color: "var(--text-primary)", padding: "4px 8px", fontSize: "12px",
            }}
          >
            <option value="day">Last 24 hours</option>
            <option value="week">Last 7 days</option>
            <option value="sprint">Current sprint</option>
          </select>
          <button
            onClick={handleGenerateReport}
            style={{
              background: "transparent", border: "1px solid var(--accent-blue)",
              color: "var(--accent-blue)", borderRadius: "6px", padding: "4px 12px",
              fontSize: "12px", cursor: "pointer",
            }}
          >
            Generate Report
          </button>
          {reportText && (
            <button
              onClick={() => { navigator.clipboard.writeText(reportText); }}
              style={{
                background: "transparent", border: "1px solid var(--accent-green)",
                color: "var(--accent-green)", borderRadius: "6px", padding: "4px 12px",
                fontSize: "12px", cursor: "pointer",
              }}
            >
              Copy to Clipboard
            </button>
          )}
        </div>
        {reportText && (
          <pre style={{
            background: "var(--bg-tertiary)", border: "1px solid var(--border)",
            borderRadius: "6px", padding: "12px", fontSize: "11px",
            color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            maxHeight: "300px", overflowY: "auto",
          }}>
            {reportText}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
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
