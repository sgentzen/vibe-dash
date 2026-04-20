import { useMemo } from "react";
import { useAppState } from "../../store";
import { ProjectRailCard } from "./ProjectRailCard";
import { HealthScoreGauge } from "./HealthScoreGauge";
import { ActiveBlockersPanel } from "./ActiveBlockersPanel";
import { MilestoneProgressPanel } from "./MilestoneProgressPanel";
import { AgentComputeHeatmap } from "./AgentComputeHeatmap";
import { TokenConsumptionChart } from "./TokenConsumptionChart";
import "./orchestration.css";

export function OrchestrationView() {
  const { projects, tasks, milestones, blockers, selectedProjectId } = useAppState();

  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  const projectTasks = useMemo(
    () => (activeProjectId ? tasks.filter((t) => t.project_id === activeProjectId) : tasks),
    [tasks, activeProjectId],
  );

  const activeBlockers = useMemo(
    () => blockers.filter(
      (b) => b.resolved_at === null && projectTasks.some((t) => t.id === b.task_id),
    ),
    [blockers, projectTasks],
  );

  const projectMilestones = useMemo(
    () => (activeProjectId ? milestones.filter((m) => m.project_id === activeProjectId) : milestones),
    [milestones, activeProjectId],
  );

  const done = useMemo(() => projectTasks.filter((t) => t.status === "done").length, [projectTasks]);

  return (
    <div className="orch-wrapper">
      <div className="orch-subheader">
        <span className="orch-subheader-title">AI Agent Orchestration Overview</span>
        <span className="orch-status-pill">AI Engine: Online</span>
      </div>

      <div className="orch-grid">
        {/* Left rail — project list */}
        <div className="orch-left-rail">
          <div className="orch-left-rail-title">Projects</div>
          {projects.length === 0 ? (
            <div style={{ fontSize: "12px", color: "var(--text-muted)", padding: "8px 0" }}>No projects yet</div>
          ) : (
            projects.map((project) => {
              const ptasks = tasks.filter((t) => t.project_id === project.id);
              const ptaskIds = new Set(ptasks.map((t) => t.id));
              const pblockers = blockers.filter(
                (b) => b.resolved_at === null && ptaskIds.has(b.task_id),
              ).length;
              return (
                <ProjectRailCard
                  key={project.id}
                  project={project}
                  tasks={ptasks}
                  blockerCount={pblockers}
                  isActive={project.id === activeProjectId}
                />
              );
            })
          )}
        </div>

        {/* Center column */}
        <div className="orch-center-col">
          <HealthScoreGauge
            done={done}
            total={projectTasks.length}
            unresolvedBlockers={activeBlockers.length}
          />
          <ActiveBlockersPanel blockers={activeBlockers} tasks={projectTasks} />
        </div>

        {/* Right column */}
        <div className="orch-right-col">
          <MilestoneProgressPanel
            milestones={projectMilestones}
            tasks={projectTasks}
            activeProjectId={activeProjectId}
          />
          <div className="orch-right-bottom">
            <AgentComputeHeatmap activeProjectId={activeProjectId} />
            <TokenConsumptionChart activeProjectId={activeProjectId} />
          </div>
        </div>
      </div>
    </div>
  );
}
