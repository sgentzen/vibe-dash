import { useState } from "react";
import { useDataState } from "../store";
import { cardStyle, sectionHeader } from "../styles/shared.js";

const DISMISS_KEY = "vibe-dash-getting-started-dismissed";

interface ChecklistItem {
  label: string;
  hint: string;
  done: boolean;
}

/**
 * Compact "next steps" checklist shown after the first project is created,
 * so onboarding doesn't dead-end. Auto-checks items from live store state and
 * hides itself once every step is complete (or the user dismisses it).
 */
export function GettingStartedChecklist() {
  const { projects, tasks, agents, milestones } = useDataState();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");

  // Only relevant once the user is past the empty first-run state.
  if (projects.length === 0 || dismissed) return null;

  // Steps are checked against global state (not the selected project) by design:
  // this is a one-time first-run nudge, and dismissal is global too.
  const items: ChecklistItem[] = [
    { label: "Create a project", hint: "You're set — a project exists.", done: true },
    { label: "Create a task", hint: "Add work on the Board or via the create_task MCP tool.", done: tasks.length > 0 },
    { label: "Connect an agent", hint: "Point an MCP client at vibe-dash so agents register.", done: agents.length > 0 },
    { label: "Add a milestone", hint: "Group tasks under a milestone to track progress.", done: milestones.length > 0 },
  ];

  const doneCount = items.filter((i) => i.done).length;
  // Nothing left to nudge — don't render.
  if (doneCount === items.length) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  }

  return (
    <div style={{ ...cardStyle, marginBottom: "var(--space-4)", borderLeft: "3px solid var(--accent-blue)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
        <div style={sectionHeader}>Getting started · {doneCount}/{items.length}</div>
        <button
          onClick={dismiss}
          aria-label="Dismiss getting started checklist"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--text-muted)", fontSize: "12px", padding: "2px 6px",
          }}
        >
          Dismiss
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span
              aria-hidden
              style={{
                color: item.done ? "var(--status-success)" : "var(--text-muted)",
                fontSize: "13px", width: "16px", flexShrink: 0,
              }}
            >
              {item.done ? "✓" : "○"}
            </span>
            <div style={{ minWidth: 0 }}>
              <span style={{
                fontSize: "13px",
                color: item.done ? "var(--text-muted)" : "var(--text-primary)",
                textDecoration: item.done ? "line-through" : "none",
              }}>
                {item.label}
              </span>
              {!item.done && (
                <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>{item.hint}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
