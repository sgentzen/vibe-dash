import { useEffect, useRef, useState, type RefObject } from "react";
import { useDataState, useNavigationState, useNotificationState, useAppDispatch, type SearchScope } from "../store";
import { useApi } from "../hooks/useApi";
import { WebhookSettings } from "./WebhookSettings";
import { GitSyncSettings } from "./GitSyncSettings";
import { StatPill } from "./topbar/StatPill";
import { ViewToggle } from "./topbar/ViewToggle";
import { NotificationBell } from "./topbar/NotificationBell";
import { AddProjectControl } from "./topbar/AddProjectControl";

interface TopBarProps {
  onCommandPalette?: () => void;
  searchInputRef?: RefObject<HTMLInputElement | null>;
}

export function TopBar({ onCommandPalette, searchInputRef }: TopBarProps = {}) {
  const { stats } = useDataState();
  const { theme, activeView, searchQuery, searchScope, alertsOpen } = useNavigationState();
  const { unreadCount, notifications } = useNotificationState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [showSettings, setShowSettings] = useState<"webhooks" | "git" | null>(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);
  const appearanceRef = useRef<HTMLDivElement>(null);

  // Initial accent color from localStorage
  const [accentColor, setAccentColor] = useState(
    () => localStorage.getItem("vibe-dash-accent") ?? "#58a6ff"
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
    setAccentColor(color);
    localStorage.setItem("vibe-dash-accent", color);
    document.documentElement.style.setProperty("--accent-user", color);
    document.documentElement.setAttribute("data-accent", "true");
  }

  async function handleAddProject(name: string) {
    const project = await api.createProject({ name });
    dispatch({ type: "WS_EVENT", payload: { type: "project_created", payload: project } });
  }

  async function handleMarkAllRead() {
    await api.markAllRead();
    dispatch({ type: "SET_UNREAD_COUNT", payload: 0 });
    dispatch({ type: "SET_NOTIFICATIONS", payload: notifications.map((n) => ({ ...n, read: true })) });
  }

  async function handleMarkRead(id: string) {
    await api.markNotificationRead(id);
    dispatch({ type: "SET_UNREAD_COUNT", payload: Math.max(0, unreadCount - 1) });
    dispatch({
      type: "SET_NOTIFICATIONS",
      payload: notifications.map((x) => (x.id === id ? { ...x, read: true } : x)),
    });
  }

  // Determine if search scope matches the active view's domain
  const scopeMismatch =
    (searchScope === "tasks" && activeView !== "board" && activeView !== "list") ||
    (searchScope === "projects" && activeView !== "dashboard" && activeView !== "orchestration") ||
    (searchScope === "agents" && activeView !== "agents");

  const scopeHintLabel: Record<SearchScope, string> = {
    tasks: "tasks",
    projects: "projects",
    agents: "agents",
    all: "everything",
  };

  return (
    <header
      style={{
        background: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
        padding: "0 16px",
        height: "52px",
        display: "flex",
        alignItems: "center",
        gap: "24px",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <span
        style={{
          color: "var(--accent-red)",
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
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
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
            dispatch({ type: "SET_ACTIVE_VIEW", payload: "agents" });
            dispatch({ type: "SET_SEARCH_SCOPE", payload: "agents" });
          }}
        />
        <StatPill
          label="ALERTS"
          value={stats.alerts}
          color="var(--status-warning)"
          onClick={() => dispatch({ type: "SET_ALERTS_OPEN", payload: true })}
        />
        <StatPill
          label="TASKS"
          value={stats.tasks}
          color="var(--text-secondary)"
          onClick={() => dispatch({ type: "SET_ACTIVE_VIEW", payload: "list" })}
        />
      </div>

      {/* View Toggle */}
      <ViewToggle
        activeView={activeView}
        onChange={(view) => dispatch({ type: "SET_ACTIVE_VIEW", payload: view })}
      />

      {/* Search: scope + input + kbd hint */}
      <div style={{ display: "flex", alignItems: "center", gap: "0", position: "relative" }}>
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
          style={{
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border)",
            borderLeft: "none",
            borderRight: "none",
            color: "var(--text-primary)",
            padding: "4px 8px",
            fontSize: "13px",
            width: "140px",
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
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: "16px",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
          }}
        >
          🎨
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
                    }}
                  >
                    {t === "light" ? "☀️ Light" : "🌙 Dark"}
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

      {/* Settings Gear */}
      <div style={{ position: "relative" }}>
        <button
          onClick={() => setShowSettingsMenu(!showSettingsMenu)}
          aria-label="Settings"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "4px 8px",
            cursor: "pointer",
            color: "var(--text-secondary)",
            fontSize: "14px",
          }}
        >
          {"⚙️"}
        </button>
        {showSettingsMenu && (
          <div style={{
            position: "absolute", top: "100%", right: 0, marginTop: "4px",
            background: "var(--bg-secondary)", border: "1px solid var(--border)",
            borderRadius: "8px", zIndex: 100, boxShadow: "var(--shadow-md)",
            minWidth: "160px", overflow: "hidden",
          }}>
            <button
              onClick={() => { setShowSettings("webhooks"); setShowSettingsMenu(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                background: "transparent", border: "none", padding: "8px 14px",
                fontSize: "13px", color: "var(--text-primary)", cursor: "pointer",
              }}
            >
              Webhooks
            </button>
            <button
              onClick={() => { setShowSettings("git"); setShowSettingsMenu(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                background: "transparent", border: "none", padding: "8px 14px",
                fontSize: "13px", color: "var(--text-primary)", cursor: "pointer",
              }}
            >
              GitHub Sync
            </button>
          </div>
        )}
      </div>

      {showSettings === "webhooks" && <WebhookSettings onClose={() => setShowSettings(null)} />}
      {showSettings === "git" && <GitSyncSettings onClose={() => setShowSettings(null)} />}

      {/* Notification Bell */}
      <NotificationBell
        notifications={notifications}
        unreadCount={unreadCount}
        onMarkAllRead={handleMarkAllRead}
        onMarkRead={handleMarkRead}
        alertsOpen={alertsOpen}
        onAlertsOpenChange={(open) => dispatch({ type: "SET_ALERTS_OPEN", payload: open })}
      />

      {/* Add Project */}
      <AddProjectControl onAdd={handleAddProject} />
    </header>
  );
}
