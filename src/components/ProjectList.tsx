import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { useAppState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { STATUS_COLORS } from "../constants/colors.js";
import { typeScale } from "../styles/shared.js";
import { ConfirmDialog } from "./ui/ConfirmDialog.js";
import type { Project, Task } from "../types";

export const SIDEBAR_CLASS = "sidebar";

// Visually hidden but still announced by screen readers (the standard
// clip-based sr-only pattern — display:none would remove it from the
// accessibility tree too, defeating the point).
const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

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

function archivedAnnouncement(showArchived: boolean, loading: boolean, count: number): string {
  if (!showArchived) return "Archived projects hidden";
  if (loading) return "Loading archived projects…";
  return `Showing archived projects: ${count}`;
}


export function ProjectList() {
  const { projects, tasks, selectedProjectId, searchQuery, searchScope } = useAppState();
  const dispatch = useAppDispatch();
  const api = useApi();

  const [showArchived, setShowArchived] = useState(false);
  const [archivedProjects, setArchivedProjects] = useState<Project[] | null>(null);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [confirmArchiveTarget, setConfirmArchiveTarget] = useState<Project | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Archived projects aren't part of the global store (the initial/default
  // load intentionally excludes them, same as GET /api/projects), so the
  // "show archived" toggle fetches its own list on demand rather than
  // fetching every project up front on every page load.
  useEffect(() => {
    if (!showArchived) return;
    let cancelled = false;
    setLoadingArchived(true);
    api.getProjects({ includeArchived: true })
      .then((all) => {
        if (cancelled) return;
        setArchivedProjects(all.filter((p) => p.archived_at !== null));
      })
      .catch(() => {
        if (!cancelled) setArchivedProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingArchived(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  function handleSelect(id: string) {
    dispatch({
      type: "SELECT_PROJECT",
      payload: selectedProjectId === id ? null : id,
    });
  }

  async function handleUnarchive(project: Project) {
    setActionError(null);
    try {
      const updated = await api.unarchiveProject(project.id);
      dispatch({ type: "WS_EVENT", payload: { type: "project_unarchived", payload: updated } });
      setArchivedProjects((prev) => (prev ? prev.filter((p) => p.id !== updated.id) : prev));
    } catch {
      // Nothing else in this codebase's mutation failures surfaces visibly
      // either (see OnboardingWizard) — the button stays clickable to retry —
      // but a screen-reader user gets no signal at all without this, since
      // there's no visual state change to notice by chance. Reuses the
      // archived-section's own aria-live region below.
      setActionError(`Couldn't unarchive "${project.name}". Try again.`);
    }
  }

  async function handleConfirmArchive() {
    const project = confirmArchiveTarget;
    setConfirmArchiveTarget(null);
    if (!project) return;
    setActionError(null);
    try {
      const updated = await api.archiveProject(project.id);
      dispatch({ type: "WS_EVENT", payload: { type: "project_archived", payload: updated } });
      setArchivedProjects((prev) => (prev ? [...prev, updated] : prev));
    } catch {
      // See handleUnarchive.
      setActionError(`Couldn't archive "${project.name}". Try again.`);
    }
  }

  const applyProjectSearch = searchScope === "projects" || searchScope === "all";
  const lowerProjectSearch = searchQuery.toLowerCase();
  const matchesSearch = (p: Project) =>
    !applyProjectSearch || !searchQuery || p.name.toLowerCase().includes(lowerProjectSearch);

  const visibleProjects = projects.filter(matchesSearch);
  const visibleArchived = (archivedProjects ?? []).filter(matchesSearch);

  return (
    <nav
      aria-label="Projects"
      className={`panel-scroll ${SIDEBAR_CLASS}`}
      style={{
        background: "var(--bg-secondary)",
        borderRight: "1px solid var(--border)",
        padding: "12px 0",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-3) var(--space-2)",
        }}
      >
        <span style={{ ...typeScale.micro, color: "var(--text-muted)" }}>Projects</span>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          aria-pressed={showArchived}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: "11px",
            cursor: "pointer",
            padding: 0,
            textDecoration: "underline",
          }}
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {/* Screen-reader announcement for the archived section appearing/
          loading/populating — sighted users get the visible "Archived"
          heading and cards below, but nothing else here signals the change
          to assistive tech, since the toggle button's own label already
          flips before the fetch resolves. */}
      <div aria-live="polite" style={visuallyHiddenStyle}>
        {actionError ?? archivedAnnouncement(showArchived, loadingArchived, visibleArchived.length)}
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
          onArchive={() => setConfirmArchiveTarget(project)}
        />
      ))}

      {showArchived && (
        <>
          <div
            style={{
              ...typeScale.micro,
              padding: "var(--space-3) var(--space-3) var(--space-2)",
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border)",
              marginTop: "var(--space-2)",
            }}
          >
            Archived
          </div>
          {loadingArchived && (
            <div style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: "12px" }}>
              Loading archived projects…
            </div>
          )}
          {!loadingArchived && visibleArchived.length === 0 && (
            <div
              style={{
                padding: "8px 12px",
                color: "var(--text-muted)",
                fontSize: "12px",
                fontStyle: "italic",
              }}
            >
              No archived projects
            </div>
          )}
          {visibleArchived.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              tasks={tasks.filter((t) => t.project_id === project.id)}
              selected={false}
              archived
              onSelect={() => {}}
              onUnarchive={() => handleUnarchive(project)}
            />
          ))}
        </>
      )}

      {confirmArchiveTarget && (
        <ConfirmDialog
          title="Archive project?"
          message={`"${confirmArchiveTarget.name}" will be hidden from the sidebar and top-bar counts. Its tasks, milestones and cost history are kept, and you can restore it anytime from "Show archived".`}
          confirmLabel="Archive"
          destructive
          onConfirm={handleConfirmArchive}
          onCancel={() => setConfirmArchiveTarget(null)}
        />
      )}
    </nav>
  );
}

function ProjectCard({
  project,
  tasks,
  selected,
  onSelect,
  archived = false,
  onArchive,
  onUnarchive,
}: Readonly<{
  project: Project;
  tasks: Task[];
  selected: boolean;
  onSelect: () => void;
  archived?: boolean;
  onArchive?: () => void;
  onUnarchive?: () => void;
}>) {
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
      // Explicit name, not the default content-derived one: the card now
      // contains a nested Archive/Unarchive <button> (plus an "Archived"
      // badge), and without this, the outer role="button"'s accessible name
      // would fold their text in too — e.g. "ProjectName Archived
      // Unarchive" — per the accname spec's name-from-content algorithm.
      aria-label={project.name}
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
          (e.currentTarget).style.background = "var(--bg-tertiary)";
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget).style.background = selected
          ? "var(--green-bg)"
          : "transparent";
      }}
    >
      {/* Status dot + name + archive/unarchive action */}
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
            flex: 1,
          }}
          title={project.name}
        >
          {project.name}
        </span>
        {archived && (
          <span
            style={{
              ...typeScale.caption,
              flexShrink: 0,
              padding: "1px 6px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
            }}
          >
            Archived
          </span>
        )}
        {(onArchive || onUnarchive) && (
          <button
            type="button"
            aria-label={archived ? `Unarchive project ${project.name}` : `Archive project ${project.name}`}
            onClick={(e) => {
              e.stopPropagation();
              (archived ? onUnarchive : onArchive)?.();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            style={{
              ...typeScale.caption,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            {archived ? "Unarchive" : "Archive"}
          </button>
        )}
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
