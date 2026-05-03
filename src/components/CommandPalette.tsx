import { useState, useEffect, useRef } from "react";
import { useAppState, useAppDispatch } from "../store.js";
import type { AppState } from "../store.js";

type ViewId = AppState["activeView"];

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: string;
  action: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
}

const VIEW_COMMANDS: { id: ViewId; label: string; icon: string }[] = [
  { id: "board", label: "Board", icon: "⊞" },
  { id: "agents", label: "Agents", icon: "◎" },
  { id: "list", label: "List", icon: "≡" },
  { id: "dashboard", label: "Dashboard", icon: "⊡" },
  { id: "timeline", label: "Timeline", icon: "⌛" },
  { id: "activity", label: "Activity", icon: "⚡" },
];

export function CommandPalette({ onClose }: CommandPaletteProps) {
  const { tasks, projects } = useAppState();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const viewCommands: Command[] = VIEW_COMMANDS.map(({ id, label, icon }) => ({
    id: `view-${id}`,
    label,
    description: `Go to ${label} view`,
    icon,
    action: () => {
      dispatch({ type: "SET_ACTIVE_VIEW", payload: id });
      onClose();
    },
  }));

  const projectCommands: Command[] = projects.map((p) => ({
    id: `project-${p.id}`,
    label: p.name,
    description: p.description ?? "Project",
    icon: "◫",
    action: () => {
      dispatch({ type: "SELECT_PROJECT", payload: p.id });
      onClose();
    },
  }));

  const taskCommands: Command[] = tasks
    .filter((t) => t.status !== "done")
    .slice(0, 50)
    .map((t) => ({
      id: `task-${t.id}`,
      label: t.title,
      description: `${t.status} · ${t.priority}`,
      icon: t.status === "in_progress" ? "●" : t.status === "blocked" ? "⚠" : "○",
      action: () => {
        dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" });
        dispatch({ type: "SET_SEARCH_QUERY", payload: t.title });
        onClose();
      },
    }));

  const allCommands = [...viewCommands, ...projectCommands, ...taskCommands];

  const q = query.trim().toLowerCase();
  const filtered = q
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(q) ||
          (c.description && c.description.toLowerCase().includes(q))
      )
    : allCommands;

  const filteredViews = filtered.filter((c) => c.id.startsWith("view-"));
  const filteredProjects = filtered.filter((c) => c.id.startsWith("project-"));
  const filteredTasks = filtered.filter((c) => c.id.startsWith("task-")).slice(0, 8);

  const sections: { label: string; commands: Command[] }[] = [];
  if (filteredViews.length > 0) sections.push({ label: "Views", commands: filteredViews });
  if (filteredProjects.length > 0) sections.push({ label: "Projects", commands: filteredProjects });
  if (filteredTasks.length > 0) sections.push({ label: "Tasks", commands: filteredTasks });

  const flatCommands = sections.flatMap((s) => s.commands);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      flatCommands[selectedIndex]?.action();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  let globalIdx = 0;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "80px",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          width: "480px",
          maxHeight: "420px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "var(--shadow-lg)",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            gap: "10px",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontSize: "15px", lineHeight: 1 }}>⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks, views, projects…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "14px",
            }}
          />
          <kbd
            style={{
              color: "var(--text-muted)",
              fontSize: "10px",
              background: "var(--bg-tertiary)",
              padding: "2px 6px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: "auto", flex: 1 }}>
          {sections.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--text-muted)",
                fontSize: "13px",
              }}
            >
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.label}>
                <div
                  style={{
                    padding: "8px 16px 2px",
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "var(--text-muted)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  {section.label}
                </div>
                {section.commands.map((cmd) => {
                  const myIdx = globalIdx++;
                  const isSelected = myIdx === selectedIndex;
                  return (
                    <div
                      key={cmd.id}
                      data-idx={myIdx}
                      onClick={cmd.action}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "7px 16px",
                        cursor: "pointer",
                        background: isSelected ? "var(--bg-tertiary)" : "transparent",
                        borderLeft: `2px solid ${isSelected ? "var(--accent-blue)" : "transparent"}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          width: "16px",
                          textAlign: "center",
                          flexShrink: 0,
                          color: "var(--text-muted)",
                        }}
                      >
                        {cmd.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "13px",
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {cmd.label}
                        </div>
                        {cmd.description && (
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {cmd.description}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            padding: "6px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            gap: "16px",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
