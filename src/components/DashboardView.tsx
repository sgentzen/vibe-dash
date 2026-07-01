import { useState, useEffect } from "react";
import { useDataState, useNavigationState, usePollingState } from "../store";
import { useApi } from "../hooks/useApi";
import { cardStyle, sectionHeader, typeScale } from "../styles/shared.js";
import type { MilestoneDailyStats, ActivityHeatmapEntry, AgentContribution, AgentComparison } from "../types";
import { KpiCard, formatTokens } from "./dashboard/KpiCard";
import { CostTimeseriesCard, CostByModelCard, CostByAgentCard } from "./dashboard/CostCards";
import { AgentEfficiencyCard } from "./dashboard/AgentEfficiencyCard";
import { MilestoneProgressCard, MilestoneOverviewCard } from "./dashboard/MilestoneCards";
import { AgentContributionsCard, ActivityHeatmapCard } from "./dashboard/ActivityCards";
import { BlockersCard, OverdueTasksCard } from "./dashboard/BlockerOverdueCards";
import { LiveRosterCard } from "./dashboard/LiveRosterCard";
import { TodayCard } from "./dashboard/TodayCard";

const headerStyle: React.CSSProperties = { ...sectionHeader, fontSize: "13px" };

type ChartSetters = {
  setHeatmap: (h: ActivityHeatmapEntry[]) => void;
  setDailyStats: (s: MilestoneDailyStats[]) => void;
  setContributions: (c: AgentContribution[]) => void;
};

type CostSetters = {
  setCostSummary: (s: { total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null) => void;
  setCostTimeseries: (ts: { date: string; total_cost_usd: number }[]) => void;
  setCostByModel: (m: { model: string; provider: string; total_cost_usd: number; total_tokens: number }[]) => void;
  setCostByAgent: (a: { agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]) => void;
};

async function loadChartData(
  api: ReturnType<typeof useApi>,
  projectId: string | null,
  firstOpenMilestoneId: string | null | undefined,
  setters: ChartSetters,
): Promise<void> {
  try {
    const heat = await api.getActivityHeatmap(projectId ?? undefined);
    setters.setHeatmap(heat);

    if (firstOpenMilestoneId) {
      const [stats, contrib] = await Promise.all([
        api.getMilestoneDailyStats(firstOpenMilestoneId),
        api.getMilestoneContributions(firstOpenMilestoneId),
      ]);
      setters.setDailyStats(stats);
      setters.setContributions(contrib);
    } else {
      setters.setDailyStats([]);
      setters.setContributions([]);
    }
  } catch (e) {
    console.warn("[DashboardView] failed to load chart data", e);
  }
}

async function loadCostData(
  api: ReturnType<typeof useApi>,
  projectId: string | null,
  setters: CostSetters,
): Promise<void> {
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
  } catch (e) {
    console.warn("[DashboardView] failed to load cost data", e);
  }
}

// Bucket the heatmap entries (Unix-hour timestamps) into a 7-element day-count array.
function computeActivityLast7(heatmap: ActivityHeatmapEntry[]): number[] {
  const todayDay = Math.floor(Date.now() / 86_400_000);
  const buckets: Record<number, number> = {};
  for (const e of heatmap) {
    const day = Math.floor((e.hour * 3_600_000) / 86_400_000);
    if (day >= todayDay - 6) buckets[day] = (buckets[day] ?? 0) + e.count;
  }
  return Array.from({ length: 7 }, (_, i) => buckets[todayDay - 6 + i] ?? 0);
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
  const [heatmap, setHeatmap] = useState<ActivityHeatmapEntry[]>([]);
  const [contributions, setContributions] = useState<AgentContribution[]>([]);
  const [costSummary, setCostSummary] = useState<{ total_cost_usd: number; total_input_tokens: number; total_output_tokens: number; entry_count: number } | null>(null);
  const [costTimeseries, setCostTimeseries] = useState<{ date: string; total_cost_usd: number }[]>([]);
  const [costByModel, setCostByModel] = useState<{ model: string; provider: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [costByAgent, setCostByAgent] = useState<{ agent_id: string; agent_name: string; total_cost_usd: number; total_tokens: number }[]>([]);
  const [agentComparison, setAgentComparison] = useState<AgentComparison | null>(null);

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

  // Last-7-days activity sparkline derived from heatmap (ActivityHeatmapEntry.hour is Unix hour number)
  const activityLast7 = computeActivityLast7(heatmap);

  // Compact tile layout when ≥2 of the 4 KPI values are zero
  const activeTasks = projectTasks.filter((t) => t.status !== "done").length;
  const isCompact =
    [openMilestones.length, overdueTasks.length, unresolvedBlockers.length, activeTasks].filter(
      (v) => v === 0
    ).length >= 2;

  const milestoneTaskStatusKey = computeMilestoneStatusKey(openMilestones, projectTasks);

  const firstOpenMilestoneId = openMilestones.length > 0 ? openMilestones[0]?.id : null;

  useEffect(() => {
    loadChartData(api, projectId, firstOpenMilestoneId, { setHeatmap, setDailyStats, setContributions });
  }, [api, firstOpenMilestoneId, projectId, milestoneTaskStatusKey, pollGeneration]);

  useEffect(() => {
    loadCostData(api, projectId, { setCostSummary, setCostTimeseries, setCostByModel, setCostByAgent });
  }, [api, projectId, milestoneTaskStatusKey, pollGeneration]);

  useEffect(() => {
    api.getAgentComparison().then(setAgentComparison).catch(() => {});
  }, [api, pollGeneration]);

  return (
    <div style={{ flex: 1, padding: "var(--space-4)", overflowY: "auto" }}>
      <h2 style={{ ...typeScale.body, fontWeight: 600, color: "var(--text-primary)", margin: "0 0 var(--space-4) 0" }}>
        Dashboard
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "65fr 35fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <LiveRosterCard agents={agents} tasks={tasks} />
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
          sparkline={isCompact ? undefined : activityLast7}
          compact={isCompact}
        />
        <KpiCard
          label="Overdue Tasks"
          value={String(overdueTasks.length)}
          color={overdueTasks.length > 0 ? "var(--status-danger)" : "var(--status-success)"}
          sparkline={isCompact ? undefined : activityLast7}
          compact={isCompact}
        />
        <KpiCard
          label="Active Blockers"
          value={String(unresolvedBlockers.length)}
          color={unresolvedBlockers.length > 0 ? "var(--status-warning)" : "var(--status-success)"}
          sparkline={isCompact ? undefined : activityLast7}
          compact={isCompact}
        />
        <KpiCard
          label="Active Tasks"
          value={String(activeTasks)}
          color="var(--text-secondary)"
          sparkline={isCompact ? undefined : activityLast7}
          compact={isCompact}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <MilestoneProgressCard dailyStats={dailyStats} openMilestones={openMilestones} />
        <MilestoneOverviewCard openMilestones={openMilestones} projectTasks={projectTasks} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <AgentContributionsCard contributions={contributions} openMilestones={openMilestones} />
        <ActivityHeatmapCard heatmap={heatmap} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}>
        <BlockersCard blockers={unresolvedBlockers} />
        <OverdueTasksCard tasks={overdueTasks} />
      </div>

      {costSummary && costSummary.entry_count > 0 ? (
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
      ) : (
        <div style={{ ...cardStyle, marginBottom: "var(--space-4)" }}>
          <div style={headerStyle}>Cost & Token Tracking</div>
          <div style={{ color: "var(--text-muted)", fontSize: "12px" }}>
            No cost data recorded yet. Agents report costs via the <code style={{ color: "var(--accent-blue)" }}>log_cost</code> MCP tool after completing work. Cost cards will appear here once data is available.
          </div>
        </div>
      )}

      {agentComparison && <AgentEfficiencyCard agentComparison={agentComparison} />}
    </div>
  );
}
