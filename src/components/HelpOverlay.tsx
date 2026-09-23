import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { FocusTrap } from "focus-trap-react";
import { sectionHeader } from "../styles/shared.js";
import { useApi } from "../hooks/useApi";
import type { HealthInfo } from "../hooks/useApi";

interface HelpOverlayProps {
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  label: string;
  seq?: boolean; // keys pressed in sequence (e.g. g then f) rather than as a chord
}

const GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["g", "f"], label: "Go to Fleet", seq: true },
      { keys: ["g", "b"], label: "Go to Board", seq: true },
      { keys: ["g", "v"], label: "Go to Feed", seq: true },
      { keys: ["g", "o"], label: "Fleet · Overview", seq: true },
      { keys: ["g", "a"], label: "Fleet · Agents", seq: true },
    ],
  },
  {
    title: "Search & Commands",
    shortcuts: [
      { keys: ["⌘", "K"], label: "Focus search" },
      { keys: ["/"], label: "Focus search" },
      { keys: ["⌘", "⇧", "K"], label: "Command palette" },
      { keys: ["Esc"], label: "Clear search / close overlays" },
    ],
  },
  {
    title: "Help",
    shortcuts: [{ keys: ["?"], label: "Show this help" }],
  },
];

const kbdStyle: React.CSSProperties = {
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: "4px",
  color: "var(--text-primary)",
  padding: "1px 7px",
  fontSize: "12px",
  fontFamily: "inherit",
  minWidth: "18px",
  textAlign: "center",
  lineHeight: "18px",
};

/** Short build identity line for the footer below. "unknown" collapses to
 * nothing rather than printing the literal word three times. */
function formatBuildLine(health: HealthInfo | null): string | null {
  if (!health) return null;
  const parts: string[] = [];
  if (health.version) parts.push(`v${health.version}`);
  if (health.commit && health.commit !== "unknown") parts.push(health.commit.slice(0, 7));
  if (health.buildTime && health.buildTime !== "unknown") parts.push(`built ${health.buildTime}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function HelpOverlay({ onClose }: Readonly<HelpOverlayProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const api = useApi();
  const [health, setHealth] = useState<HealthInfo | null>(null);

  // Fetched on open rather than polled: this is build identity, which cannot
  // change while the process the browser is talking to keeps running. A
  // failure here (older server, network hiccup) leaves the footer absent
  // rather than blocking the shortcuts list it sits below.
  useEffect(() => {
    let cancelled = false;
    api.getHealth()
      .then((h) => { if (!cancelled) setHealth(h); })
      .catch(() => { /* footer stays absent; shortcuts remain usable */ });
    return () => { cancelled = true; };
  }, [api]);

  // Native <dialog> (rather than a div with role="dialog") for built-in modal
  // semantics/backdrop. showModal() isn't implemented in jsdom, so fall back to
  // the open attribute there — tests still render the content either way.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }, []);

  const buildLine = formatBuildLine(health);

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: true, onDeactivate: onClose, clickOutsideDeactivates: true, tabbableOptions: { displayCheck: "none" } }}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-dismiss; Escape is handled by FocusTrap's escapeDeactivates */}
      <dialog
        ref={dialogRef}
        aria-label="Keyboard shortcuts"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        onClose={onClose}
        onCancel={onClose}
        style={{
          position: "fixed", inset: 0,
          margin: 0, padding: 0, border: "none",
          width: "100%", height: "100%", maxWidth: "none", maxHeight: "none",
          background: "rgba(0,0,0,0.6)",
          zIndex: 400,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "440px",
          width: "90%",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h2 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600, margin: 0 }}>
              Keyboard Shortcuts
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close keyboard shortcuts"
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--text-muted)", fontSize: "18px", lineHeight: 1, padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: "16px" }}>
              <div style={{ ...sectionHeader, marginBottom: "8px" }}>{group.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {group.shortcuts.map((s) => (
                  <div key={s.label + s.keys.join()} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ color: "var(--text-secondary)", fontSize: "13px" }}>{s.label}</span>
                    <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {s.keys.map((k, i) => (
                        <span key={k + i} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          {i > 0 && s.seq && <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>then</span>}
                          <kbd style={kbdStyle}>{k}</kbd>
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {buildLine && (
            // role="status"/aria-live="polite": this text arrives after the
            // dialog is already open and focus is elsewhere (the close
            // button), from an async fetch with no user action or focus
            // change to cue it — WCAG 4.1.3 Status Messages. Polite, not
            // assertive: it is not worth interrupting a screen reader user
            // already reading the shortcut list above.
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: "4px",
                paddingTop: "12px",
                borderTop: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: "11px",
                textAlign: "center",
              }}
            >
              Vibe Dash {buildLine}
            </div>
          )}
        </div>
      </dialog>
    </FocusTrap>
  );
}
