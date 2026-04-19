import { useState, useEffect } from "react";
import FocusTrap from "focus-trap-react";
import { useApi } from "../hooks/useApi";
import { inputStyle, buttonPrimary } from "../styles/shared.js";
import type { Webhook } from "../types";

const EVENT_TYPES = [
  "task_created", "task_updated", "task_completed",
  "blocker_reported", "comment_added", "notification_created",
  "project_created", "file_conflict_detected",
];

export function WebhookSettings({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);

  useEffect(() => {
    api.getWebhooks().then(setWebhooks).catch(() => {});
  }, [api]);

  async function handleAdd() {
    if (!newUrl.trim() || newEvents.length === 0) return;
    try {
      const hook = await api.createWebhook(newUrl.trim(), newEvents);
      setWebhooks((prev) => [hook, ...prev]);
      setNewUrl("");
      setNewEvents([]);
    } catch { /* ignore */ }
  }

  async function handleToggle(id: string, active: boolean) {
    try {
      const updated = await api.updateWebhook(id, { active: !active });
      setWebhooks((prev) => prev.map((w) => w.id === id ? updated : w));
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteWebhook(id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
    } catch { /* ignore */ }
  }

  function toggleEvent(evt: string) {
    setNewEvents((prev) =>
      prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]
    );
  }

  const localInputStyle: React.CSSProperties = { ...inputStyle, padding: "6px 10px", fontSize: "12px" };

  return (
    <FocusTrap focusTrapOptions={{ clickOutsideDeactivates: true, escapeDeactivates: true, onDeactivate: onClose }}>
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Webhook settings"
          onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "12px", padding: "20px", width: "500px", maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600 }}>Webhook Settings</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "18px", cursor: "pointer" }}>
            {"\u2715"}
          </button>
        </div>

        {/* Add New */}
        <div style={{ marginBottom: "16px", padding: "12px", background: "var(--bg-tertiary)", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>Add Webhook</div>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            style={{ ...localInputStyle, marginBottom: "8px" }}
          />
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px" }}>Event types:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
            {EVENT_TYPES.map((evt) => (
              <button
                key={evt}
                onClick={() => toggleEvent(evt)}
                style={{
                  fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer",
                  background: newEvents.includes(evt) ? "rgba(99,102,241,0.2)" : "var(--bg-secondary)",
                  color: newEvents.includes(evt) ? "var(--accent-purple)" : "var(--text-muted)",
                  border: `1px solid ${newEvents.includes(evt) ? "var(--accent-purple)" : "var(--border)"}`,
                }}
              >
                {evt}
              </button>
            ))}
          </div>
          <button
            onClick={handleAdd}
            disabled={!newUrl.trim() || newEvents.length === 0}
            style={{
              background: "transparent", border: "1px solid var(--accent-green)",
              color: "var(--accent-green)", borderRadius: "6px", padding: "4px 16px",
              fontSize: "12px", cursor: "pointer",
            }}
          >
            Add Webhook
          </button>
        </div>

        {/* Existing Webhooks */}
        {webhooks.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px" }}>
            No webhooks configured
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {webhooks.map((w) => (
              <div key={w.id} style={{
                padding: "10px", background: "var(--bg-tertiary)", borderRadius: "8px",
                opacity: w.active ? 1 : 0.5,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>{w.url}</span>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      onClick={() => handleToggle(w.id, w.active)}
                      style={{
                        fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer",
                        background: "transparent",
                        border: `1px solid ${w.active ? "var(--accent-green)" : "var(--text-muted)"}`,
                        color: w.active ? "var(--accent-green)" : "var(--text-muted)",
                      }}
                    >
                      {w.active ? "Active" : "Paused"}
                    </button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      style={{
                        fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer",
                        background: "transparent", border: "1px solid var(--accent-red)", color: "var(--accent-red)",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                  {w.event_types.map((evt) => (
                    <span key={evt} style={{
                      fontSize: "9px", padding: "1px 5px", borderRadius: "3px",
                      background: "rgba(99,102,241,0.1)", color: "var(--accent-purple)",
                    }}>
                      {evt}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </FocusTrap>
  );
}
