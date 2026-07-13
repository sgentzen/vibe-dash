import { useEffect, useRef, useState, type RefObject } from "react";
import { useDataState, useNavigationState, useAppDispatch, type SearchScope } from "../store";
import { useApi } from "../hooks/useApi";
import { ACCENT_STORAGE_KEY, DEFAULT_ACCENT, readStoredAccentColor, sanitizeAccentColor } from "../utils/accent";
import { StatPill } from "./topbar/StatPill";
import { ViewToggle } from "./topbar/ViewToggle";
import { AddProjectControl } from "./topbar/AddProjectControl";
import { Icon } from "./icons/Icon";

interface TopBarProps {
  onCommandPalette?: () => void;
  onHelp?: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

// Where each mismatchable search scope's results actually live, for the quick-fix.
const SCOPE_FIX_LABEL: Record<string, string> = { tasks: "Board", agents: "Agents" };

export function TopBar({ onCommandPalette, onHelp, searchInputRef }: TopBarProps = {}) {
  const { stats } = useDataState();
  const { theme, activeView, searchQuery, searchScope } = useNavigationState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [showAppearance, setShowAppearance] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);

  // Initial accent color from localStorage (validated; default when unset/invalid)
  const [accentColor, setAccentColor] = useState(
    () => readStoredAccentColor() ?? DEFAULT_ACCENT
  );

  // Close appearance popover on outside click
  useEffect(() => {
    if (!showAppearance) return;
    function handleClick(e: MouseEvent) {
      if (appearanceRef.current && !appearanceRef.current.contains(e.target as Node)) {
        setShowAppearance(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAppearance]);

  function handleAccentChange(color: string) {
    // Coerce to a known-safe hex value (never the raw, possibly-tainted input)
    // before persisting to storage and applying as a CSS variable.
    const safeColor = sanitizeAccentColor(color);
    if (!safeColor) return;
    setAccentColor(safeColor);
    localStorage.setItem(ACCENT_STORAGE_KEY, safeColor);
    document.documentElement.style.setProperty("--accent-user", safeColor);
    document.documentElement.dataset.accent = "true";
  }

  async function handleAddProject(name: string) {
    const project = await api.createProject({ name });
    dispatch({ type: "WS_EVENT", payload: { type: "project_created", payload: project } });
  }

  // Determine if the search scope's results are visible from the active view.
  // "projects"/"all" results always show in the always-visible sidebar, so only
  // task and agent scopes can be genuinely out of view.
  const scopeMismatch =
    (searchScope === "tasks" && activeView !== "board") ||
    (searchScope === "agents" && activeView !== "fleet");

  const scopeHintLabel: Record<SearchScope, string> = {
    tasks: "tasks",
    projects: "projects",
    agents: "agents",
    all: "everything",
  };

  // Jump to the view where the current search scope's results are shown.
  function handleScopeFix() {
    if (searchScope === "tasks") {
      dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" });
      return;
    }
    dispatch({ type: "SET_ACTIVE_VIEW", payload: "fleet" });
    if (searchScope === "agents") dispatch({ type: "SET_FLEET_PRESET", payload: "agents" });
  }

  return (
    <header
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        padding: "0 var(--space-4)",
        minHeight: "52px",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        rowGap: "var(--space-2)",
        gap: "var(--space-4)",
        minWidth: 0,
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        zIndex: 300,
      }}
    >
      {/* Logo — accent-blue (tracks the user's custom accent); danger-red is
          reserved for alerts, so the wordmark must not claim it. */}
      <span
        style={{
          color: "var(--accent-blue)",
          fontWeight: 700,
          fontSize: "16px",
          letterSpacing: "0.1em",
          fontFamily: "monospace",
          whiteSpace: "nowrap",
          lineHeight: 1.5,
        }}
      >
        VIBE DASH
      </span>

      {/* Stats */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center", minWidth: 0, flexShrink: 1 }}>
        <StatPill
          label="PROJECTS"
          value={stats.projects}
          color="var(--accent-blue)"
          onClick={() => {
            const sidebar = document.querySelector<HTMLElement>(".sidebar");
            if (sidebar) {
              sidebar.scrollIntoView({ behavior: "smooth", block: "start" });
              sidebar.classList.add("highlight-pulse");
              setTimeout(() => sidebar.classList.remove("highlight-pulse"), 800);
            }
          }}
        />
        <StatPill
          label="ACTIVE AGENTS"
          value={stats.activeAgents}
          color="var(--status-success)"
          onClick={() => {
            dispatch({ type: "SET_ACTIVE_VIEW", payload: "fleet" });
            dispatch({ type: "SET_FLEET_PRESET", payload: "agents" });
            dispatch({ type: "SET_SEARCH_SCOPE", payload: "agents" });
          }}
        />
        <StatPill
          label="ALERTS"
          value={stats.alerts}
          color="var(--status-warning)"
          onClick={() => {
            // Surface the alert banner if one is showing; pulse it into view.
            const banner = document.querySelector<HTMLElement>('[role="alert"]');
            if (banner) {
              banner.scrollIntoView({ behavior: "smooth", block: "center" });
              banner.classList.add("highlight-pulse");
              setTimeout(() => banner.classList.remove("highlight-pulse"), 800);
            } else {
              // No active banner — take the user to the board where blockers live.
              dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" });
            }
          }}
        />
        <StatPill
          label="TASKS"
          value={stats.tasks}
          color="var(--text-secondary)"
          onClick={() => dispatch({ type: "SET_ACTIVE_VIEW", payload: "board" })}
        />
      </div>

      {/* View Toggle */}
      <ViewToggle
        activeView={activeView}
        onChange={(view) => dispatch({ type: "SET_ACTIVE_VIEW", payload: view })}
      />

      {/* Search: scope + input + kbd hint */}
      <div style={{ display: "flex", alignItems: "center", gap: "0", position: "relative", minWidth: 0, flexShrink: 1 }}>
        <select
          value={searchScope}
          onChange={(e) => dispatch({ type: "SET_SEARCH_SCOPE", payload: e.target.value as SearchScope })}
          aria-label="Search scope"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRight: "none",
            borderRadius: "6px 0 0 6px",
            color: "var(--text-secondary)",
            padding: "4px 6px",
            fontSize: "11px",
            cursor: "pointer",
            height: "28px",
          }}
        >
          <option value="all">All</option>
          <option value="tasks">Tasks</option>
          <option value="projects">Projects</option>
          <option value="agents">Agents</option>
        </select>
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => dispatch({ type: "SET_SEARCH_QUERY", payload: e.target.value })}
          placeholder={scopeMismatch ? `Searching ${scopeHintLabel[searchScope]}…` : "Search…"}
          aria-label="Search"
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderLeft: "none",
            borderRight: "none",
            color: "var(--text-primary)",
            padding: "4px 8px",
            fontSize: "13px",
            width: searchFocused ? "240px" : "140px",
            transition: "width 0.15s ease-out",
            height: "28px",
            opacity: scopeMismatch && searchQuery === "" ? 0.6 : 1,
          }}
        />
        <kbd
          aria-hidden
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderLeft: "none",
            borderRadius: "0 6px 6px 0",
            color: "var(--text-muted)",
            padding: "0 6px",
            fontSize: "11px",
            fontFamily: "inherit",
            height: "28px",
            display: "flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          ⌘K
        </kbd>
      </div>

      {/* Scope-mismatch quick-fix: jump to the view that shows this scope's results */}
      {scopeMismatch && (
        <button
          onClick={handleScopeFix}
          title={`${scopeHintLabel[searchScope]} appear in ${SCOPE_FIX_LABEL[searchScope]}`}
          style={{
            background: "transparent",
            border: "1px solid var(--accent-blue)",
            borderRadius: "6px",
            color: "var(--accent-blue)",
            padding: "4px 8px",
            fontSize: "11px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Show in {SCOPE_FIX_LABEL[searchScope]}
        </button>
      )}

      {/* Command palette trigger */}
      {onCommandPalette && (
        <button
          onClick={onCommandPalette}
          title="Command palette (⌘⇧K)"
          aria-label="Open command palette"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text-muted)",
            padding: "4px 8px",
            minHeight: "24px", // WCAG 2.5.8 minimum target size
            fontSize: "11px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontSize: "12px" }}>⌘⇧K</span>
        </button>
      )}

      {/* Keyboard shortcuts / help */}
      {onHelp && (
        <button
          onClick={onHelp}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            color: "var(--text-muted)",
            width: "28px",
            height: "28px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "13px",
          }}
        >
          ?
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Appearance Popover (theme + accent) */}
      <div ref={appearanceRef} style={{ position: "relative" }}>
        <button
          onClick={() => setShowAppearance((v) => !v)}
          aria-label="Appearance settings"
          title="Appearance"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "4px 8px",
            minHeight: "24px", // WCAG 2.5.8 minimum target size
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: "16px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          <Icon name="palette" size={16} />
        </button>
        {showAppearance && (
          <div
            role="dialog"
            aria-label="Appearance settings"
            style={{
              position: "absolute",
              top: "100%",
              right: 0,
              marginTop: "4px",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              zIndex: 100,
              boxShadow: "var(--shadow-md)",
              minWidth: "180px",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", letterSpacing: "0.05em" }}>THEME</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => dispatch({ type: "SET_THEME", payload: t })}
                    aria-label={`Switch to ${t} mode`}
                    aria-pressed={theme === t}
                    style={{
                      background: theme === t ? "var(--accent-blue)" : "var(--bg-tertiary)",
                      border: "1px solid var(--border)",
                      borderRadius: "4px",
                      color: theme === t ? "#fff" : "var(--text-secondary)",
                      padding: "3px 10px",
                      fontSize: "12px",
                      cursor: "pointer",
                      textTransform: "capitalize",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {t === "light" ? <Icon name="sun" size={14} /> : <Icon name="moon" size={14} />}
                    {t === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ padding: "8px 12px" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", letterSpacing: "0.05em" }}>ACCENT COLOR</div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => handleAccentChange(e.target.value)}
                  title="Custom accent color"
                  aria-label="Custom accent color"
                  style={{
                    width: "32px",
                    height: "28px",
                    border: "1px solid var(--border)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    background: "transparent",
                    padding: "2px",
                  }}
                />
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>{accentColor}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Project */}
      <AddProjectControl onAdd={handleAddProject} />
    </header>
  );
}
