import { useState } from "react";
import type { Task, ActivityEntry, Agent, Tag } from "../types";
import { agentColor } from "../utils/agentColors";

interface TaskCardProps {
  task: Task;
  allTasks: Task[];
  activity: ActivityEntry[];
  agents: Agent[];
  taskTags?: Tag[];
  blockingCount?: number;
  onClick: () => void;
  onDragStart: (taskId: string) => void;
}

function getDueUrgency(dueDate: string | null): "overdue" | "today" | "this-week" | null {
  if (!dueDate) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(dueDate);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "this-week";
  return null;
}

export function TaskCard({ task, allTasks, activity, agents, taskTags, blockingCount, onClick, onDragStart }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isActive = task.status === "in_progress";
  const isDone = task.status === "done";
  const isBlocked = task.status === "blocked";

  const assignedAgent = task.assigned_agent_id
    ? agents.find((a) => a.id === task.assigned_agent_id)
    : null;

  const dueUrgency = isDone ? null : getDueUrgency(task.due_date);

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
  } else if (dueUrgency === "overdue") {
    borderColor = "var(--accent-red)";
    boxShadow = "0 0 6px rgba(248, 81, 73, 0.15)";
  } else if (dueUrgency === "today") {
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

        {/* Badges row: priority, due date, agent, tags */}
        <div style={{ marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "4px", alignItems: "center" }}>
          {/* Priority badge */}
          {(task.priority === "urgent" || task.priority === "high") && (
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
          )}

          {/* Due date indicator */}
          {dueUrgency && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: dueUrgency === "overdue" ? "rgba(248,81,73,0.15)"
                  : dueUrgency === "today" ? "rgba(210,153,34,0.15)"
                  : "rgba(139,148,158,0.1)",
                color: dueUrgency === "overdue" ? "var(--accent-red)"
                  : dueUrgency === "today" ? "var(--accent-yellow)"
                  : "var(--text-muted)",
                border: `1px solid ${
                  dueUrgency === "overdue" ? "var(--accent-red)"
                  : dueUrgency === "today" ? "var(--accent-yellow)"
                  : "var(--border)"
                }`,
              }}
            >
              {dueUrgency === "overdue" ? "Overdue" : dueUrgency === "today" ? "Due today" : "Due soon"}
            </span>
          )}
          {task.due_date && !dueUrgency && !isDone && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                color: "var(--text-muted)",
                background: "rgba(139,148,158,0.1)",
              }}
            >
              Due {task.due_date}
            </span>
          )}

          {/* Assigned agent badge */}
          {assignedAgent && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: `${agentColor(assignedAgent.name)}20`,
                color: agentColor(assignedAgent.name),
                border: `1px solid ${agentColor(assignedAgent.name)}40`,
              }}
            >
              {assignedAgent.name}
            </span>
          )}

          {/* Recurring icon */}
          {task.recurrence_rule && (
            <span
              title={`Recurring: ${task.recurrence_rule}`}
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "rgba(6,182,212,0.1)",
                color: "#06b6d4",
                border: "1px solid rgba(6,182,212,0.3)",
              }}
            >
              {"\u{1F501}"} {task.recurrence_rule}
            </span>
          )}

          {/* Estimate badge */}
          {task.estimate != null && (
            <span
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "rgba(99,102,241,0.1)",
                color: "#6366f1",
                border: "1px solid rgba(99,102,241,0.3)",
              }}
            >
              {task.estimate}pt
            </span>
          )}

          {/* Dependency badge */}
          {blockingCount != null && blockingCount > 0 && (
            <span
              title={`Blocked by ${blockingCount} task${blockingCount > 1 ? "s" : ""}`}
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: "rgba(248,81,73,0.1)",
                color: "var(--accent-red)",
                border: "1px solid rgba(248,81,73,0.3)",
              }}
            >
              Blocked by {blockingCount}
            </span>
          )}

          {/* Tag pills */}
          {taskTags && taskTags.map((tag) => (
            <span
              key={tag.id}
              style={{
                fontSize: "10px",
                padding: "1px 6px",
                borderRadius: "4px",
                background: `${tag.color}20`,
                color: tag.color,
                border: `1px solid ${tag.color}40`,
              }}
            >
              {tag.name}
            </span>
          ))}
        </div>
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
