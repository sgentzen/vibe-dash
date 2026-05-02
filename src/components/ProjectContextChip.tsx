import { useDataState, useNavigationState } from "../store";
import { agentColor } from "../utils/agentColors";

export function ProjectContextChip() {
  const { projects } = useDataState();
  const { selectedProjectId } = useNavigationState();

  const project = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : projects[0];

  if (!project) return null;

  const color = agentColor(project.name);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        fontSize: "11px",
        color: "var(--text-secondary)",
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "2px 8px",
        fontWeight: 500,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      {project.name}
    </span>
  );
}
