import type { Project, Task } from "../../types";
import { useAppDispatch } from "../../store";

interface Props {
  project: Project;
  tasks: Task[];
  blockerCount: number;
  isActive: boolean;
}

function getProgressColor(pct: number): string {
  if (pct >= 0.9) return "var(--accent-green)";
  if (pct >= 0.5) return "var(--accent-blue)";
  if (pct > 0) return "var(--accent-yellow)";
  return "var(--bg-tertiary)";
}

export function ProjectRailCard({ project, tasks, blockerCount, isActive }: Props) {
  const dispatch = useAppDispatch();
  const done = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const pct = total > 0 ? done / total : 0;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;

  let badgeText: string;
  let badgeColor: string;
  if (blockerCount > 0) {
    badgeText = `${blockerCount} blocked`;
    badgeColor = "var(--accent-red)";
  } else if (inProgress > 0) {
    badgeText = `${inProgress} in progress`;
    badgeColor = "var(--accent-blue)";
  } else if (total > 0 && done === total) {
    badgeText = "complete";
    badgeColor = "var(--accent-green)";
  } else {
    badgeText = `${total} planned`;
    badgeColor = "var(--text-muted)";
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isActive}
      onClick={() => dispatch({ type: "SELECT_PROJECT", payload: isActive ? null : project.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          dispatch({ type: "SELECT_PROJECT", payload: isActive ? null : project.id });
        }
      }}
      style={{
        padding: "12px",
        borderRadius: "8px",
        border: `1px solid ${isActive ? "var(--accent-blue)" : "var(--border)"}`,
        background: "var(--bg-secondary)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-tertiary)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--bg-secondary)";
      }}
    >
      {/* Row 1: name */}
      <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)", marginBottom: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {project.name}
      </div>

      {/* Row 2: badge + counter */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <span style={{
          fontSize: "10px",
          fontWeight: 600,
          padding: "1px 6px",
          borderRadius: "4px",
          background: `color-mix(in srgb, ${badgeColor} 15%, transparent)`,
          color: badgeColor,
          border: `1px solid color-mix(in srgb, ${badgeColor} 30%, transparent)`,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}>
          {badgeText}
        </span>
        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
          {done}/{total} done
        </span>
      </div>

      {/* Row 3: progress bar */}
      <div className="orch-progress-bar-track">
        <div
          className="orch-progress-bar-fill"
          style={{ width: `${pct * 100}%`, background: getProgressColor(pct) }}
        />
      </div>
    </div>
  );
}
