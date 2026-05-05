import { useAppState, useAppDispatch } from "../store";
import { STATUS_COLORS } from "../constants/colors.js";
import { typeScale } from "../styles/shared.js";
import type { Project, Task } from "../types";

export const SIDEBAR_CLASS = "sidebar";

function getProjectStatus(tasks: Task[]): "active" | "blocked" | "idle" {
  if (tasks.some((t) => t.status === "blocked")) return "blocked";
  if (tasks.some((t) => t.status === "in_progress")) return "active";
  return "idle";
}

function getBorderColor(status: "active" | "blocked" | "idle"): string {
  if (status === "active") return "var(--status-success)";
  if (status === "blocked") return "var(--status-warning)";
  return "var(--text-muted)";
}


export function ProjectList() {
  const { projects, tasks, selectedProjectId, searchQuery, searchScope } = useAppState();
  const dispatch = useAppDispatch();

  function handleSelect(id: string) {
    dispatch({
      type: "SELECT_PROJECT",
      payload: selectedProjectId === id ? null : id,
    });
  }

  const applyProjectSearch = searchScope === "projects" || searchScope === "all";
  const lowerProjectSearch = searchQuery.toLowerCase();
  const visibleProjects = applyProjectSearch && searchQuery
    ? projects.filter((p) => p.name.toLowerCase().includes(lowerProjectSearch))
    : projects;

  return (
    <aside
      className={`panel-scroll ${SIDEBAR_CLASS}`}
      style={{
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        padding: "12px 0",
      }}
    >
      <div
        style={{
          ...typeScale.micro,
          padding: "0 var(--space-3) var(--space-2)",
          color: "var(--text-muted)",
        }}
      >
        Projects
      </div>

      {visibleProjects.length === 0 && (
        <div
          style={{
            padding: "16px 12px",
            color: "var(--text-muted)",
            fontSize: "12px",
            fontStyle: "italic",
          }}
        >
          {projects.length === 0 ? "No projects yet" : "No projects match search"}
        </div>
      )}

      {visibleProjects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          tasks={tasks.filter((t) => t.project_id === project.id)}
          selected={selectedProjectId === project.id}
          onSelect={() => handleSelect(project.id)}
        />
      ))}
    </aside>
  );
}

function ProjectCard({
  project,
  tasks,
  selected,
  onSelect,
}: {
  project: Project;
  tasks: Task[];
  selected: boolean;
  onSelect: () => void;
}) {
  const status = getProjectStatus(tasks);
  const borderColor = getBorderColor(status);
  const counts = {
    planned: tasks.filter((t) => t.status === "planned").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
    done: tasks.filter((t) => t.status === "done").length,
  };

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      style={{
        borderLeft: `3px solid ${borderColor}`,
        background: selected ? "var(--green-bg)" : "transparent",
        padding: "10px 12px 10px 9px",
        cursor: "pointer",
        transition: "background 0.15s",
        marginBottom: "2px",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = selected
          ? "var(--green-bg)"
          : "transparent";
      }}
    >
      {/* Status dot + name */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
        <span
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: borderColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            ...typeScale.body,
            color: "var(--text-primary)",
            fontWeight: selected ? 600 : 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={project.name}
        >
          {project.name}
        </span>
      </div>

      {/* Mini progress bar */}
      {tasks.length > 0 && (
        <div
          style={{
            display: "flex",
            height: "4px",
            borderRadius: "2px",
            overflow: "hidden",
            gap: "1px",
            marginBottom: "5px",
          }}
        >
          {(["planned", "in_progress", "blocked", "done"] as const).map(
            (s) =>
              counts[s] > 0 && (
                <div
                  key={s}
                  style={{
                    flex: counts[s],
                    background: STATUS_COLORS[s],
                  }}
                />
              )
          )}
        </div>
      )}

      {/* Task count summary */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {tasks.length === 0 ? (
          <span style={{ ...typeScale.caption, color: "var(--text-muted)" }}>no tasks</span>
        ) : (
          <>
            {counts.in_progress > 0 && (
              <span style={{ ...typeScale.caption, color: "var(--status-success)" }}>
                {counts.in_progress} in progress
              </span>
            )}
            {counts.blocked > 0 && (
              <span style={{ ...typeScale.caption, color: "var(--status-warning)" }}>
                {counts.blocked} blocked
              </span>
            )}
            {counts.done > 0 && (
              <span style={{ ...typeScale.caption, color: "var(--text-muted)" }}>
                {counts.done}/{tasks.length} done
              </span>
            )}
            {counts.in_progress === 0 && counts.blocked === 0 && counts.done === 0 && (
              <span style={{ ...typeScale.caption, color: "var(--text-muted)" }}>
                {tasks.length} planned
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
