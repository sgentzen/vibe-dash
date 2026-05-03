import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { useAppState } from "../store";
import { inputStyle } from "../styles/shared.js";
import type { GitIntegrationSafe, GitSyncResult } from "../types";

interface SyncState {
  loading: boolean;
  result: GitSyncResult | null;
  error: string | null;
}

export function GitSyncSettings({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const { projects } = useAppState();
  const [integrations, setIntegrations] = useState<GitIntegrationSafe[]>([]);
  const [syncStates, setSyncStates] = useState<Record<string, SyncState>>({});

  // Form state
  const [projectId, setProjectId] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [autoSync, setAutoSync] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    api.getGitIntegrations().then(setIntegrations).catch(() => {});
  }, [api]);

  async function handleAdd() {
    if (!projectId || !owner.trim() || !repo.trim() || !token.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const integration = await api.addGitIntegration({
        project_id: projectId,
        provider: "github",
        owner: owner.trim(),
        repo: repo.trim(),
        token: token.trim(),
        auto_sync: autoSync,
      });
      setIntegrations((prev) => [integration, ...prev]);
      setOwner("");
      setRepo("");
      setToken("");
      setAutoSync(false);
      setProjectId("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add integration");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteGitIntegration(id);
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
    } catch { /* ignore */ }
  }

  async function handleSync(id: string) {
    setSyncStates((prev) => ({ ...prev, [id]: { loading: true, result: null, error: null } }));
    try {
      const result = await api.syncGitIntegration(id);
      setSyncStates((prev) => ({ ...prev, [id]: { loading: false, result, error: null } }));
      // Update last_synced_at in the list
      setIntegrations((prev) =>
        prev.map((i) => i.id === id ? { ...i, last_synced_at: new Date().toISOString() } : i)
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sync failed";
      setSyncStates((prev) => ({ ...prev, [id]: { loading: false, result: null, error: msg } }));
    }
  }

  const localInputStyle: React.CSSProperties = { ...inputStyle, padding: "6px 10px", fontSize: "12px" };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-secondary)", border: "1px solid var(--border)",
          borderRadius: "12px", padding: "20px", width: "560px", maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ color: "var(--text-primary)", fontSize: "16px", fontWeight: 600 }}>
            GitHub Sync
          </h3>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: "18px", cursor: "pointer" }}
          >
            {"✕"}
          </button>
        </div>

        {/* Add Integration Form */}
        <div style={{ marginBottom: "16px", padding: "12px", background: "var(--bg-tertiary)", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>
            Add GitHub Integration
          </div>

          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            style={{ ...localInputStyle, marginBottom: "8px", width: "100%" }}
          >
            <option value="">Select project...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="owner (e.g. octocat)"
              style={{ ...localInputStyle, flex: 1 }}
            />
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="repo (e.g. hello-world)"
              style={{ ...localInputStyle, flex: 1 }}
            />
          </div>

          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="GitHub personal access token"
            style={{ ...localInputStyle, marginBottom: "8px", width: "100%" }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
            <input
              type="checkbox"
              id="git-auto-sync"
              checked={autoSync}
              onChange={(e) => setAutoSync(e.target.checked)}
            />
            <label htmlFor="git-auto-sync" style={{ fontSize: "12px", color: "var(--text-secondary)", cursor: "pointer" }}>
              Auto-sync (manual trigger still required — future feature)
            </label>
          </div>

          {addError && (
            <div style={{ fontSize: "11px", color: "var(--accent-red)", marginBottom: "6px" }}>
              {addError}
            </div>
          )}

          <button
            onClick={handleAdd}
            disabled={adding || !projectId || !owner.trim() || !repo.trim() || !token.trim()}
            style={{
              background: "transparent", border: "1px solid var(--accent-green)",
              color: "var(--accent-green)", borderRadius: "6px", padding: "4px 16px",
              fontSize: "12px", cursor: "pointer",
              opacity: (!projectId || !owner.trim() || !repo.trim() || !token.trim()) ? 0.5 : 1,
            }}
          >
            {adding ? "Adding..." : "Add Integration"}
          </button>
        </div>

        {/* Integration List */}
        {integrations.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px" }}>
            No GitHub integrations configured
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {integrations.map((integration) => {
              const sync = syncStates[integration.id];
              const projectName = projects.find((p) => p.id === integration.project_id)?.name ?? integration.project_id;
              return (
                <div
                  key={integration.id}
                  style={{ padding: "10px", background: "var(--bg-tertiary)", borderRadius: "8px" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                    <div>
                      <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: 600 }}>
                        {integration.owner}/{integration.repo}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "8px" }}>
                        {projectName}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <button
                        onClick={() => handleSync(integration.id)}
                        disabled={sync?.loading}
                        style={{
                          fontSize: "10px", padding: "2px 10px", borderRadius: "4px", cursor: "pointer",
                          background: "transparent",
                          border: "1px solid var(--accent-blue)",
                          color: "var(--accent-blue)",
                          opacity: sync?.loading ? 0.5 : 1,
                        }}
                      >
                        {sync?.loading ? "Syncing..." : "Sync Now"}
                      </button>
                      <button
                        onClick={() => handleDelete(integration.id)}
                        style={{
                          fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer",
                          background: "transparent", border: "1px solid var(--accent-red)", color: "var(--accent-red)",
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                    {integration.last_synced_at
                      ? `Last synced: ${new Date(integration.last_synced_at).toLocaleString()}`
                      : "Never synced"}
                    {integration.token_configured && (
                      <span style={{ marginLeft: "8px", color: "var(--accent-green)" }}>Token configured</span>
                    )}
                  </div>

                  {sync?.result && (
                    <div style={{
                      marginTop: "6px", padding: "6px 8px", background: "rgba(34,197,94,0.1)",
                      borderRadius: "4px", fontSize: "11px", color: "var(--accent-green)",
                    }}>
                      Sync complete: {sync.result.issues_pulled} tasks created, {sync.result.issues_updated} updated
                      {sync.result.errors.length > 0 && (
                        <span style={{ color: "var(--accent-yellow)", marginLeft: "8px" }}>
                          {sync.result.errors.length} error(s)
                        </span>
                      )}
                    </div>
                  )}

                  {sync?.error && (
                    <div style={{
                      marginTop: "6px", padding: "6px 8px", background: "rgba(239,68,68,0.1)",
                      borderRadius: "4px", fontSize: "11px", color: "var(--accent-red)",
                    }}>
                      Error: {sync.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
