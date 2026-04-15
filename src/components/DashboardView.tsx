import { useState, useEffect } from "react";
import { useAppState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader } from "../styles/shared.js";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution } from "../types";

export function DashboardView() {
  const { projects, milestones, blockers, tasks, selectedProjectId, pollGeneration } = useAppState();
  const api = useApi();

  const [dailyStats, setDailyStats] = useState<MilestoneDailyStats[]>([]);
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<"day" | "week" | "milestone">("week");
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);

  // Project-scoped data — null means "all projects"
  const projectId = selectedProjectId ?? null;
  const projectMilestones = projectId ? milestones.filter((m) => m.project_id === projectId) : milestones;
  const projectTasks = projectId ? tasks.filter((t) => t.project_id === projectId) : tasks;
  const projectTaskIds = new Set(projectTasks.map((t) => t.id));
  const projectBlockers = projectId ? blockers.filter((b) => projectTaskIds.has(b.task_id)) : blockers;

  const openMilestones = projectMilestones.filter((m) => m.status === "open");
  const overdueTasks = projectTasks.filter(
    (t) => t.due_date && t.status !== "done" && new Date(t.due_date) < new Date()
  );
  const unresolvedBlockers = projectBlockers.filter((b) => !b.resolved_at);
  const doneTaskCount = projectTasks.filter((t) => t.status === "done").length;

  // Track task status changes for open milestones to trigger dashboard refreshes
  const milestoneTaskStatusKey = openMilestones.length > 0
    ? openMilestones.map((m) => projectTasks.filter((t) => t.milestone_id === m.id).map((t) => `${t.id}:${t.status}`).join(";")).join("|")
    : "";

  // Dashboard charts: refresh on milestone task status changes + polling
  useEffect(() => {
    async function load() {
      try {
        const heat = await api.getActivityHeatmap(projectId ?? undefined);
        setHeatmap(heat);

        if (openMilestones.length > 0) {
          const firstOpenMilestone = openMilestones[0];
          const [stats, contrib] = await Promise.all([
            api.getMilestoneDailyStats(firstOpenMilestone.id),
            api.getMilestoneContributions(firstOpenMilestone.id),
          ]);
          setDailyStats(stats);
          setContributions(contrib);
        } else {
          setDailyStats([]);
          setContributions([]);
        }
      } catch (e) {
        console.warn("[DashboardView] failed to load chart data", e);
      }
    }
    load();
  }, [api, openMilestones.length > 0 ? openMilestones[0]?.id : null, projectId, milestoneTaskStatusKey, pollGeneration]);

  // Cost data: refresh on project change or milestone task status changes
  useEffect(() => {
    async function loadCosts() {
      try {
        const [summary, ts, byModel, byAgent] = await Promise.all([
          api.getCostSummary(projectId ?? undefined),
          api.getCostTimeseries({ project_id: projectId ?? undefined, days: "30" }),
          api.getCostByModel({ project_id: projectId ?? undefined }),
          api.getCostByAgent({ project_id: projectId ?? undefined }),
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
  }, [api, projectId, milestoneTaskStatusKey, pollGeneration]);

  async function handleGenerateReport() {
    const reportProjectId = projectId ?? projects[0]?.id;
    if (!reportProjectId) return;
    try {
      const report = await api.generateReport(reportProjectId, reportPeriod);
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
        <KpiCard label="Open Milestones" value={String(openMilestones.length)} color="var(--accent-blue)" />
        <KpiCard label="Overdue Tasks" value={String(overdueTasks.length)} color={overdueTasks.length > 0 ? "var(--accent-red)" : "var(--accent-green)"} />
        <KpiCard label="Active Blockers" value={String(unresolvedBlockers.length)} color={unresolvedBlockers.length > 0 ? "var(--accent-yellow)" : "var(--accent-green)"} />
        <KpiCard label="Active Tasks" value={String(projectTasks.filter((t) => t.status !== "done").length)} color="var(--text-secondary)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Milestone Completion */}
        <div style={cardStyle}>
          <div style={headerStyle}>Milestone Progress {openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}</div>
          {dailyStats.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              {openMilestones.length > 0 ? "No progress data yet. Complete tasks to see progress." : "No open milestones — create a milestone to see progress."}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "120px" }}>
              {dailyStats.map((d) => {
                const pct = d.completion_pct;
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

        {/* Milestone Completion Percentage */}
        <div style={cardStyle}>
          <div style={headerStyle}>Open Milestones Overview</div>
          {openMilestones.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No open milestones. Create a milestone to track progress.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {openMilestones.map((m) => {
                const milestoneTasks = projectTasks.filter((t) => t.milestone_id === m.id);
                const completedCount = milestoneTasks.filter((t) => t.status === "done").length;
                const totalCount = milestoneTasks.length;
                const pct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
                return (
                  <div key={m.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" }}>
                      <span style={{ color: "var(--text-primary)" }}>{m.name}</span>
                      <span style={{ color: "var(--text-muted)" }}>{completedCount}/{totalCount}</span>
                    </div>
                    <div style={{ height: "4px", background: "var(--bg-tertiary)", borderRadius: "2px" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent-green)", borderRadius: "2px" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
        {/* Agent Contributions */}
        <div style={cardStyle}>
          <div style={headerStyle}>Agent Contributions {openMilestones.length > 0 ? `(${openMilestones[0].name})` : ""}</div>
          {contributions.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              {openMilestones.length > 0 ? "No contributions yet." : "No open milestones — create a milestone to track agent contributions."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {contributions.map((c) => (
                <div key={c.agent_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                  <span style={{ color: "var(--text-primary)" }}>{c.agent_name}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {c.completed_count} tasks
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

      {/* Cost & Token Tracking — only show details when cost data exists */}
      {costSummary && costSummary.entry_count > 0 ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
            <KpiCard label="Total Spend" value={`$${costSummary.total_cost_usd.toFixed(2)}`} color="var(--accent-blue)" />
            <KpiCard label="Input Tokens" value={formatTokens(costSummary.total_input_tokens)} color="var(--text-secondary)" />
            <KpiCard label="Output Tokens" value={formatTokens(costSummary.total_output_tokens)} color="var(--text-secondary)" />
            <KpiCard
              label="Avg Cost/Task"
              value={doneTaskCount > 0 ? `$${(costSummary.total_cost_usd / doneTaskCount).toFixed(3)}` : "$0.00"}
              color="var(--accent-green)"
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
            <div style={cardStyle}>
              <div style={headerStyle}>Daily Spend (Last 30 Days)</div>
              {costTimeseries.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No daily breakdown available yet.</div>
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

            <div style={cardStyle}>
              <div style={headerStyle}>Cost by Model</div>
              {costByModel.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>No model breakdown available yet.</div>
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
        </>
      ) : (
        <div style={{ ...cardStyle, marginBottom: "16px" }}>
          <div style={headerStyle}>Cost & Token Tracking</div>
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            No cost data recorded yet. Agents report costs via the <code style={{ color: "var(--accent-blue)" }}>log_cost</code> MCP tool after completing work. Cost cards will appear here once data is available.
          </div>
        </div>
      )}

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
            onChange={(e) => setReportPeriod(e.target.value as "day" | "week" | "milestone")}
            style={{
              background: "var(--bg-tertiary)", border: "1px solid var(--border)",
              borderRadius: "4px", color: "var(--text-primary)", padding: "4px 8px", fontSize: "12px",
            }}
          >
            <option value="day">Last 24 hours</option>
            <option value="week">Last 7 days</option>
            <option value="milestone">Current milestone</option>
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
