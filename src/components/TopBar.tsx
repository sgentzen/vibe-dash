import { useState } from "react";
import { useDataState, useNavigationState, useNotificationState, useAppDispatch } from "../store";
import { useApi } from "../hooks/useApi";
import { WebhookSettings } from "./WebhookSettings";
import { StatPill } from "./topbar/StatPill";
import { ViewToggle } from "./topbar/ViewToggle";
import { NotificationBell } from "./topbar/NotificationBell";
import { AddProjectControl } from "./topbar/AddProjectControl";

export function TopBar() {
  const { stats } = useDataState();
  const { theme, activeView, searchQuery } = useNavigationState();
  const { unreadCount, notifications } = useNotificationState();
  const dispatch = useAppDispatch();
  const api = useApi();
  const [showSettings, setShowSettings] = useState(false);

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
        }}
      >
        VIBE DASH
      </span>

      {/* Stats */}
      <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
        <StatPill label="PROJECTS" value={stats.projects} color="var(--accent-blue)" />
        <StatPill label="ACTIVE AGENTS" value={stats.activeAgents} color="var(--accent-green)" />
        <StatPill label="ALERTS" value={stats.alerts} color="var(--accent-yellow)" />
        <StatPill label="TASKS" value={stats.tasks} color="var(--text-secondary)" />
      </div>

      {/* View Toggle */}
      <ViewToggle
        activeView={activeView}
        onChange={(view) => dispatch({ type: "SET_ACTIVE_VIEW", payload: view })}
      />

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => dispatch({ type: "SET_SEARCH_QUERY", payload: e.target.value })}
        placeholder="Search tasks..."
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          color: "var(--text-primary)",
          padding: "4px 10px",
          fontSize: "13px",
          width: "160px",
        }}
      />

      {/* Command palette trigger */}
      {onCommandPalette && (
        <button
          onClick={onCommandPalette}
          title="Command palette (⌘K)"
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
          <span style={{ fontSize: "13px" }}>⌘</span>
          <kbd style={{ fontFamily: "inherit", fontSize: "11px" }}>K</kbd>
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Theme Toggle */}
      <button
        onClick={() => dispatch({ type: "SET_THEME", payload: theme === "dark" ? "light" : "dark" })}
        aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
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
        {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
      </button>

      {/* Accent Color Picker */}
      <input
        type="color"
        value={localStorage.getItem("vibe-dash-accent") ?? "#58a6ff"}
        onChange={(e) => {
          const color = e.target.value;
          localStorage.setItem("vibe-dash-accent", color);
          document.documentElement.style.setProperty("--accent-user", color);
          document.documentElement.setAttribute("data-accent", "true");
        }}
        title="Custom accent color"
        style={{
          width: "28px",
          height: "28px",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          cursor: "pointer",
          background: "transparent",
          padding: "2px",
        }}
      />

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
      />

      {/* Add Project */}
      <AddProjectControl onAdd={handleAddProject} />
    </header>
  );
}
