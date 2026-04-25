import { useState } from "react";

interface Props {
  needsSetup: boolean;
  onAuthenticated: () => void;
}

export function LoginPage({ needsSetup, onAuthenticated }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [newKey, setNewKey] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/setup", { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setError(body.error ?? "Setup failed");
        return;
      }
      const data = await res.json() as { api_key: string };
      setNewKey(data.api_key);
      setApiKey(data.api_key);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      if (!res.ok) {
        setError("Invalid API key");
        return;
      }
      onAuthenticated();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", gap: "1.5rem" }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-color)", borderRadius: "12px", padding: "2rem", width: "360px", display: "flex", flexDirection: "column", gap: "1rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Vibe Dash</h1>

        {needsSetup && !newKey && (
          <>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              No admin key configured. Generate one to get started.
            </p>
            <button onClick={handleSetup} disabled={loading} style={{ padding: "0.6rem 1rem", borderRadius: "6px", background: "var(--accent-blue)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 500 }}>
              {loading ? "Generating…" : "Generate API Key"}
            </button>
          </>
        )}

        {newKey && (
          <>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              Save this key — it will not be shown again.
            </p>
            <code style={{ background: "var(--bg-primary)", padding: "0.5rem", borderRadius: "6px", fontSize: "0.8rem", wordBreak: "break-all" }}>{newKey}</code>
            <button onClick={handleLogin} disabled={loading} style={{ padding: "0.6rem 1rem", borderRadius: "6px", background: "var(--accent-blue)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 500 }}>
              {loading ? "Logging in…" : "Log In With This Key"}
            </button>
          </>
        )}

        {(!needsSetup || newKey) && (
          <>
            <input
              type="password"
              placeholder="API key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleLogin(); }}
              style={{ padding: "0.6rem 0.75rem", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--bg-primary)", color: "var(--text-primary)", fontSize: "0.875rem" }}
            />
            <button onClick={handleLogin} disabled={loading || !apiKey} style={{ padding: "0.6rem 1rem", borderRadius: "6px", background: "var(--accent-blue)", border: "none", color: "#fff", cursor: "pointer", fontWeight: 500 }}>
              {loading ? "Logging in…" : "Log In"}
            </button>
          </>
        )}

        {error && <p style={{ margin: 0, color: "var(--accent-red)", fontSize: "0.875rem" }}>{error}</p>}
      </div>
    </div>
  );
}
