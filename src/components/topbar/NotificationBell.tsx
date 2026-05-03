import { useState } from "react";
import type { AppNotification } from "../../types";

interface NotificationBellProps {
  notifications: AppNotification[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
}

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
}: NotificationBellProps) {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        aria-label="Notifications"
        style={{
          background: "transparent",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "4px 8px",
          cursor: "pointer",
          color: "var(--text-secondary)",
          fontSize: "14px",
          position: "relative",
        }}
      >
        {"\uD83D\uDD14"}
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: "-4px", right: "-4px",
            background: "var(--status-danger)", color: "var(--text-on-accent)",
            fontSize: "10px", fontWeight: 700, borderRadius: "50%",
            width: "16px", height: "16px", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {showNotifications && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: "4px",
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "8px", width: "320px", maxHeight: "400px",
          overflowY: "auto", zIndex: 100, boxShadow: "var(--shadow-md)",
        }}>
          <div style={{
            padding: "8px 12px", borderBottom: "1px solid var(--border)",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                style={{ background: "transparent", border: "none", color: "var(--accent-blue)", fontSize: "11px", cursor: "pointer" }}
              >
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
              No notifications
            </div>
          ) : (
            notifications.slice(0, 20).map((n) => (
              <div
                key={n.id}
                onClick={() => {
                  if (!n.read) onMarkRead(n.id);
                }}
                style={{
                  padding: "8px 12px", borderBottom: "1px solid var(--border)",
                  cursor: "pointer", background: n.read ? "transparent" : "rgba(99,102,241,0.05)",
                }}
              >
                <div style={{ fontSize: "12px", color: n.read ? "var(--text-muted)" : "var(--text-primary)" }}>
                  {n.message}
                </div>
                <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
