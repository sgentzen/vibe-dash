import { useState, useEffect, useCallback } from "react";
import { useDataState, useNavigationState, usePollingState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader, typeScale } from "../styles/shared.js";
import type { MilestoneDailyStats, AgentComparison } from "../types";
import { KpiCard, formatTokens } from "./dashboard/KpiCard";
import { CostTimeseriesCard, CostByModelCard, CostByAgentCard } from "./dashboard/CostCards";
import { AgentEfficiencyCard } from "./dashboard/AgentEfficiencyCard";
import { MilestoneProgressCard, MilestoneOverviewCard } from "./dashboard/MilestoneCards";
import { BlockersCard, OverdueTasksCard } from "./dashboard/BlockerOverdueCards";
import { TodayCard } from "./dashboard/TodayCard";
import { GettingStartedChecklist } from "./GettingStartedChecklist";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

type CostSetters = {
  setCostSummary: (s: { total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null) => void;
  setCostTimeseries: (ts: { date: string; total_cost_usd: number }[]) => void;
  setCostByModel: (m: { model: string; provider: string; total_cost_usd: number; total_tokens: number }[]) => void;
  setCostByAgent: (a: { agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]) => void;
};

async function loadChartData(
  api: ReturnType<typeof useApi>,
  milestoneId: string | null | undefined,
  setDailyStats: (s: MilestoneDailyStats[]) => void,
): Promise<void> {
  try {
    if (milestoneId) {
      const stats = await api.getMilestoneDailyStats(milestoneId);
      setDailyStats(stats);
    } else {
      setDailyStats([]);
    }
  } catch (e) {
    console.warn("[DashboardView] failed to load chart data", e);
  }
}

async function loadCostData(
  api: ReturnType<typeof useApi>,
  projectId: string | null,
  setters: CostSetters,
): Promise<boolean> {
  try {
    const [summary, ts, byModel, byAgent] = await Promise.all([
      api.getCostSummary(projectId ?? undefined),
      api.getCostTimeseries({ project_id: projectId ?? undefined, days: "30" }),
      api.getCostByModel({ project_id: projectId ?? undefined }),
      api.getCostByAgent({ project_id: projectId ?? undefined }),
    ]);
    setters.setCostSummary(summary);
    setters.setCostTimeseries(ts);
    setters.setCostByModel(byModel);
    setters.setCostByAgent(byAgent);
    return true;
  } catch (e) {
    console.warn("[DashboardView] failed to load cost data", e);
    return false;
  }
}

// Stable dependency key that changes whenever a task's milestone/status pairing
// within the open milestones changes, used to re-fetch chart data.
function computeMilestoneStatusKey(
  openMilestones: { id: string }[],
  projectTasks: { id: string; milestone_id: string | null; status: string }[],
): string {
  if (openMilestones.length === 0) return "";
  return openMilestones
    .map((m) => projectTasks.filter((t) => t.milestone_id === m.id).map((t) => `${t.id}:${t.status}`).join(";"))
    .join("|");
}

export function DashboardView() {
  const { milestones, blockers, tasks, agents, stats } = useDataState();
  const { selectedProjectId } = useNavigationState();
  const { pollGeneration } = usePollingState();
  const api = useApi();

  const [dailyStats, setDailyStats] = useState<MilestoneDailyStats[]>([]);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [agentComparison, setAgentComparison] = useState<AgentComparison | null>(null);
  const [costError, setCostError] = useState(false);

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

  // Compact tile layout when ≥2 of the 4 KPI values are zero
  const activeTasks = projectTasks.filter((t) => t.status !== "done").length;
  const isCompact =
    [openMilestones.length, overdueTasks.length, unresolvedBlockers.length, activeTasks].filter(
      (v) => v === 0
    ).length >= 2;

  const milestoneTaskStatusKey = computeMilestoneStatusKey(openMilestones, projectTasks);

  const firstOpenMilestoneId = openMilestones.length > 0 ? openMilestones[0]?.id : null;

  // The chart follows the user's selection when it still points at an open
  // milestone; otherwise it falls back to the first open one (e.g. after the
  // selected milestone closes or the project changes).
  const effectiveMilestoneId =
    selectedMilestoneId && openMilestones.some((m) => m.id === selectedMilestoneId)
      ? selectedMilestoneId
      : firstOpenMilestoneId;

  useEffect(() => {
    loadChartData(api, effectiveMilestoneId, setDailyStats);
  }, [api, effectiveMilestoneId, milestoneTaskStatusKey, pollGeneration]);

  const reloadCosts = useCallback(async () => {
    setCostError(false);
    const ok = await loadCostData(api, projectId, { setCostSummary, setCostTimeseries, setCostByModel, setCostByAgent });
    if (!ok) setCostError(true);
  }, [api, projectId]);

  useEffect(() => {
    reloadCosts();
  }, [reloadCosts, milestoneTaskStatusKey, pollGeneration]);

  useEffect(() => {
    api.getAgentComparison().then(setAgentComparison).catch(() => {});
  }, [api, pollGeneration]);

  return (
    <div tabIndex={0} role="region" aria-label="Dashboard" style={{ flex: 1, padding: "var(--space-4)", overflowY: "auto" }}>
      <h2 style={{ ...typeScale.body, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 var(--space-4) 0" }}>
        Dashboard
      </h2>

      <GettingStartedChecklist />

      <div style={{ marginBottom: "var(--space-4)" }}>
        <TodayCard
          spendToday={stats.spend_today}
          tasksCompletedToday={stats.tasks_completed_today}
          activeAgents={agents.filter((a) => a.health_status === "active").length}
        />
      </div>

      <div style={isCompact ? {
        display: "flex",
        gap: "var(--space-3)",
        marginBottom: "var(--space-4)",
      } : {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "var(--space-3)",
        marginBottom: "var(--space-4)",
      }}>
        <KpiCard
          label="Open Milestones"
          value={String(openMilestones.length)}
          color="var(--accent-blue)"
          compact={isCompact}
        />
        <KpiCard
          label="Overdue Tasks"
          value={String(overdueTasks.length)}
          color={overdueTasks.length > 0 ? "var(--status-danger)" : "var(--status-success)"}
          compact={isCompact}
        />
        <KpiCard
          label="Active Blockers"
          value={String(unresolvedBlockers.length)}
          color={unresolvedBlockers.length > 0 ? "var(--status-warning)" : "var(--status-success)"}
          compact={isCompact}
        />
        <KpiCard
          label="Active Tasks"
          value={String(activeTasks)}
          color="var(--text-secondary)"
          compact={isCompact}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <MilestoneProgressCard
          dailyStats={dailyStats}
          openMilestones={openMilestones}
          selectedMilestoneId={effectiveMilestoneId ?? null}
          onSelectMilestone={setSelectedMilestoneId}
        />
        <MilestoneOverviewCard openMilestones={openMilestones} projectTasks={projectTasks} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <BlockersCard blockers={unresolvedBlockers} />
        <OverdueTasksCard tasks={overdueTasks} />
      </div>

      {(() => {
        if (costError) {
          return (
            <div style={{ ...cardStyle, marginBottom: "var(--space-4)" }}>
              <div style={headerStyle}>Cost & Token Tracking</div>
              <div style={{ color: "var(--status-danger)", fontSize: "12px", marginBottom: "8px" }}>
                Couldn&apos;t load cost data. The dashboard will retry automatically, or retry now.
              </div>
              <button
                onClick={() => reloadCosts()}
                style={{
                  background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)",
                  padding: "4px 12px", borderRadius: "4px", cursor: "pointer", fontSize: "12px",
                }}
              >
                Retry
              </button>
            </div>
          );
        }
        if (costSummary && costSummary.entry_count > 0) {
          return (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
                <KpiCard label="Total Spend" value={`$${costSummary.total_cost_usd.toFixed(2)}`} color="var(--accent-blue)" />
                <KpiCard label="Input Tokens" value={formatTokens(costSummary.total_input_tokens)} color="var(--text-secondary)" />
                <KpiCard label="Output Tokens" value={formatTokens(costSummary.total_output_tokens)} color="var(--text-secondary)" />
                <KpiCard
                  label="Avg Cost/Task"
                  value={doneTaskCount > 0 ? `$${(costSummary.total_cost_usd / doneTaskCount).toFixed(3)}` : "$0.00"}
                  color="var(--status-success)"
                  tooltip="Total spend divided by number of done tasks. Reflects all-time data, not just the current period."
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
                <CostTimeseriesCard data={costTimeseries} />
                <CostByModelCard data={costByModel} />
              </div>

              <CostByAgentCard data={costByAgent} />
            </>
          );
        }
        return (
          <div style={{ ...cardStyle, marginBottom: "var(--space-4)" }}>
            <div style={headerStyle}>Cost & Token Tracking</div>
            <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
              No cost data recorded yet. Agents report costs via the <code style={{ color: "var(--accent-blue)" }}>log_cost</code> MCP tool after completing work. Cost cards will appear here once data is available.
            </div>
          </div>
        );
      })()}

      {agentComparison && <AgentEfficiencyCard agentComparison={agentComparison} />}
    </div>
  );
}
