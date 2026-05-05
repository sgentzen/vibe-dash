import { useState, useEffect } from "react";
import { useApi, setStoredApiKey } from "../hooks/useApi";
import { useNavigationState, useAppDispatch } from "../store";
import type { User } from "../types";

export function UserManagement() {
  const api = useApi();
  const dispatch = useAppDispatch();
  const { currentUser } = useNavigationState();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<{ userId: string; key: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", role: "viewer" as string });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.role !== "admin") return;
    api.listUsers().then(setUsers).catch(() => {}).finally(() => setLoading(false));
  }, [api, currentUser]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const { user, api_key } = await api.createUser(form);
      setUsers((prev) => [...prev, user]);
      setNewKey({ userId: user.id, key: api_key });
      setForm({ name: "", email: "", role: "viewer" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(id: string, role: string) {
    const updated = await api.updateUserRole(id, role);
    setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
  }

  async function handleDelete(id: string) {
    await api.deleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  async function handleRotateKey(id: string) {
    const { api_key } = await api.rotateKey(id);
    if (id === currentUser?.id) {
      setStoredApiKey(api_key);
    }
    setNewKey({ userId: id, key: api_key });
  }

  if (currentUser?.role !== "admin") {
    return (
      <p style={{ color: "var(--text-muted)", padding: "1rem" }}>
        Admin access required.
      </p>
    );
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 700, display: "flex", flexDirection: "column", gap: "2rem" }}>
      <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: "1.2rem" }}>User Management</h2>

      {/* Create user form */}
      <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <h3 style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem", fontWeight: 600 }}>
          Create User
        </h3>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            required
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            style={inputStyle}
          />
          <input
            required
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            style={inputStyle}
          />
          <select
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            style={{ ...inputStyle, cursor: "pointer" }}
            aria-label="Role"
          >
            <option value="viewer">Viewer</option>
            <option value="developer">Developer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={creating} style={btnStyle}>
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
        {error && <p role="alert" style={{ margin: 0, color: "var(--accent-red)", fontSize: "0.8rem" }}>{error}</p>}
      </form>

      {/* New key reveal */}
      {newKey && (
        <div role="alert" style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--accent-green)",
          borderRadius: 8,
          padding: "1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}>
          <p style={{ margin: 0, color: "var(--accent-green)", fontWeight: 600, fontSize: "0.85rem" }}>
            API key generated — copy it now, it will not be shown again:
          </p>
          <code style={{
            display: "block",
            background: "var(--bg-primary)",
            padding: "0.5rem 0.75rem",
            borderRadius: 6,
            color: "var(--text-primary)",
            fontSize: "0.8rem",
            wordBreak: "break-all",
          }}>
            {newKey.key}
          </code>
          <button
            onClick={() => { navigator.clipboard.writeText(newKey.key); }}
            style={{ ...btnStyle, alignSelf: "flex-start", fontSize: "0.8rem" }}
          >
            Copy
          </button>
          <button
            onClick={() => setNewKey(null)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "0.75rem", padding: 0, alignSelf: "flex-end" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* User list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.9rem", fontWeight: 600 }}>
          Users {!loading && `(${users.length})`}
        </h3>
        {loading ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Loading...</p>
        ) : users.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>No users yet.</p>
        ) : (
          users.map((user) => (
            <div key={user.id} style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.65rem 0.875rem",
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.875rem" }}>{user.name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>{user.email}</span>
              </div>
              <select
                value={user.role}
                onChange={(e) => handleRoleChange(user.id, e.target.value)}
                disabled={user.id === currentUser?.id}
                aria-label={`Role for ${user.name}`}
                style={{ ...inputStyle, fontSize: "0.8rem", padding: "0.3rem 0.5rem", cursor: "pointer" }}
              >
                <option value="viewer">Viewer</option>
                <option value="developer">Developer</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={() => handleRotateKey(user.id)}
                title="Rotate API key"
                style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.3rem 0.6rem", background: "var(--bg-tertiary)" }}
              >
                Rotate Key
              </button>
              {user.id !== currentUser?.id && (
                <button
                  onClick={() => handleDelete(user.id)}
                  aria-label={`Delete ${user.name}`}
                  style={{ ...btnStyle, fontSize: "0.75rem", padding: "0.3rem 0.6rem", background: "var(--accent-red)" }}
                >
                  Delete
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Logout */}
      <button
        onClick={() => {
          setStoredApiKey(null);
          dispatch({ type: "SET_AUTH", payload: { currentUser: null, isAuthenticated: false, authEnabled: true } });
        }}
        style={{ ...btnStyle, alignSelf: "flex-start", background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
      >
        Sign Out
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  background: "var(--bg-tertiary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text-primary)",
  fontSize: "0.875rem",
  outline: "none",
};

const btnStyle: React.CSSProperties = {
  padding: "0.5rem 0.875rem",
  background: "var(--accent-purple)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  fontWeight: 600,
  fontSize: "0.875rem",
  cursor: "pointer",
};
