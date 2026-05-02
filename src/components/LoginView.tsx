import { useState } from "react";
import { useApi, setStoredApiKey } from "../hooks/useApi";
import { useAppDispatch } from "../store";

export function LoginView() {
  const api = useApi();
  const dispatch = useAppDispatch();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const user = await api.validateApiKey(apiKey.trim());
      setStoredApiKey(apiKey.trim());
      dispatch({
        type: "SET_AUTH",
        payload: { currentUser: user, isAuthenticated: true, authEnabled: true },
      });
    } catch {
      setError("Invalid API key. Check your key and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "var(--bg-primary)",
    }}>
      <div style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "2.5rem 2rem",
        width: "100%",
        maxWidth: 380,
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚡</div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", color: "var(--text-primary)", fontWeight: 700 }}>
            Vibe Dash
          </h1>
          <p style={{ margin: "0.5rem 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
            Enter your API key to continue
          </p>
        </div>

        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label htmlFor="api-key-input" style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontWeight: 600 }}>
              API Key
            </label>
            <input
              id="api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your API key"
              autoComplete="current-password"
              style={{
                padding: "0.65rem 0.875rem",
                background: "var(--bg-tertiary)",
                border: `1px solid ${error ? "var(--accent-red)" : "var(--border)"}`,
                borderRadius: 8,
                color: "var(--text-primary)",
                fontSize: "0.9rem",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
          </div>

          {error && (
            <p role="alert" style={{ margin: 0, color: "var(--accent-red)", fontSize: "0.8rem" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            style={{
              padding: "0.7rem 1rem",
              background: "var(--accent-purple)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: loading || !apiKey.trim() ? "not-allowed" : "pointer",
              opacity: loading || !apiKey.trim() ? 0.6 : 1,
            }}
          >
            {loading ? "Verifying..." : "Sign In"}
          </button>
        </form>

        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.75rem", textAlign: "center" }}>
          API keys are managed by an administrator via <code style={{ fontFamily: "monospace" }}>POST /api/users</code>
        </p>
      </div>
    </div>
  );
}
