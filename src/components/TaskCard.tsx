import { useState } from "react";
import type { Task, ActivityEntry } from "../types";

interface TaskCardProps {
  task: Task;
  allTasks: Task[];
  activity: ActivityEntry[];
  onClick: () => void;
  onDragStart: (taskId: string) => void;
}

export function TaskCard({ task, allTasks, activity, onClick, onDragStart }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isActive = task.status === "in_progress";
  const isDone = task.status === "done";
  const isBlocked = task.status === "blocked";

  const childTasks = allTasks.filter((t) => t.parent_task_id === task.id);
  const hasChildren = childTasks.length > 0;
  const childDone = childTasks.filter((t) => t.status === "done").length;

  const latestActivity = activity
    .filter((a) => a.task_id === task.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

  const descSnippet = task.description
    ? task.description.slice(0, 80) + (task.description.length > 80 ? "\u2026" : "")
    : null;

  let borderColor = "var(--border)";
  let background = "var(--bg-tertiary)";
  let boxShadow = "none";

  if (isActive) {
    borderColor = "var(--accent-green)";
    background = "var(--green-bg)";
    boxShadow = "0 0 8px rgba(63, 185, 80, 0.2)";
  } else if (isBlocked) {
    borderColor = "var(--accent-yellow)";
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: "6px",
        padding: "10px",
        background,
        boxShadow,
        cursor: "pointer",
        opacity: isDone ? 0.6 : 1,
        transition: "opacity 0.15s, border-color 0.15s",
        userSelect: "none",
      }}
    >
      <div onClick={onClick}>
        {/* Title */}
        <div
          style={{
            color: "var(--text-primary)",
            fontSize: "13px",
            fontWeight: 500,
            marginBottom: descSnippet || isActive || hasChildren ? "6px" : 0,
            display: "flex",
            alignItems: "flex-start",
            gap: "4px",
          }}
        >
          {isDone && (
            <span style={{ color: "var(--accent-green)", flexShrink: 0 }}>{"\u2713"}</span>
          )}
          {isActive && (
            <span className="pulse-dot" style={{ marginTop: "5px", flexShrink: 0 }} />
          )}
          <span>{task.title}</span>
        </div>

        {/* Description snippet */}
        {descSnippet && (
          <div
            style={{
              color: "var(--text-secondary)",
              fontSize: "12px",
              marginBottom: isActive ? "6px" : 0,
            }}
          >
            {descSnippet}
          </div>
        )}

        {/* Active task: latest activity + progress bar */}
        {isActive && (
          <>
            {latestActivity && (
              <div
                style={{
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  marginBottom: "6px",
                  fontStyle: "italic",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {latestActivity.message}
              </div>
            )}
            <div
              style={{
                height: "3px",
                background: "var(--bg-secondary)",
                borderRadius: "2px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${task.progress}%`,
                  background: "var(--accent-green)",
                  borderRadius: "2px",
                  transition: "width 0.3s",
                }}
              />
            </div>
          </>
        )}

        {/* Priority badge */}
        {task.priority === "urgent" || task.priority === "high" ? (
          <div style={{ marginTop: "6px" }}>
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background:
                  task.priority === "urgent" ? "rgba(248,81,73,0.15)" : "rgba(210,153,34,0.15)",
                color:
                  task.priority === "urgent" ? "var(--accent-red)" : "var(--accent-yellow)",
                border: `1px solid ${
                  task.priority === "urgent" ? "var(--accent-red)" : "var(--accent-yellow)"
                }`,
              }}
            >
              {task.priority}
            </span>
          </div>
        ) : null}
      </div>

      {/* Sub-tasks toggle */}
      {hasChildren && (
        <div style={{ marginTop: "6px" }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent-blue)",
              fontSize: "11px",
              cursor: "pointer",
              padding: "2px 0",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span style={{ fontSize: "9px" }}>{expanded ? "\u25BC" : "\u25B6"}</span>
            {childDone}/{childTasks.length} sub-tasks
          </button>

          {expanded && (
            <div
              style={{
                marginTop: "6px",
                paddingLeft: "8px",
                borderLeft: "2px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              {childTasks.map((child) => (
                <SubTaskRow key={child.id} task={child} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SubTaskRow({ task }: { task: Task }) {
  const isDone = task.status === "done";
  const isActive = task.status === "in_progress";
  const isBlocked = task.status === "blocked";

  let color = "var(--text-secondary)";
  if (isDone) color = "var(--text-muted)";
  if (isActive) color = "var(--accent-green)";
  if (isBlocked) color = "var(--accent-yellow)";

  const icon = isDone ? "\u2713" : isActive ? "\u25cf" : isBlocked ? "\u26a0" : "\u25cb";

  return (
    <div
      style={{
        fontSize: "11px",
        color,
        display: "flex",
        alignItems: "center",
        gap: "5px",
        padding: "2px 0",
        textDecoration: isDone ? "line-through" : "none",
        opacity: isDone ? 0.6 : 1,
      }}
    >
      <span style={{ flexShrink: 0, fontSize: "9px" }}>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {task.title}
      </span>
    </div>
  );
}
