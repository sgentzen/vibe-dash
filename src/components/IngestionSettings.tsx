import { useState, useEffect } from "react";
import { useApi } from "../hooks/useApi";
import { inputStyle, buttonPrimary } from "../styles/shared.js";
import type { IngestionSource, IngestionSourceKind } from "../types";

const KIND_LABELS: Record<IngestionSourceKind, string> = {
  claude_code: "Claude Code",
  cursor: "Cursor",
  codex: "Codex CLI",
  copilot: "Copilot Workspace",
  aider: "Aider",
  generic: "Generic Webhook",
};

const KIND_DOCS: Record<IngestionSourceKind, string> = {
  claude_code: "Add to .claude/settings.json hooks — see integrations/claude-code/hooks.json",
  cursor: "Configure Cursor agent logging — see integrations/cursor/README.md",
  codex: "Run Codex with the wrapper script — see integrations/codex/README.md",
  copilot: "Configure Copilot Workspace event forwarding — see integrations/copilot-workspace/README.md",
  aider: "Run Aider with --json output — see integrations/aider/README.md",
  generic: "POST any JSON to the endpoint — see integrations/generic/curl-example.sh",
};

const SOURCE_KINDS = Object.keys(KIND_LABELS) as IngestionSourceKind[];

export function IngestionSettings() {
  const api = useApi();
  const [sources, setSources] = useState<IngestionSource[]>([]);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<IngestionSourceKind>("claude_code");
  const [pendingToken, setPendingToken] = useState<{ id: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const localInputStyle: React.CSSProperties = { ...inputStyle, padding: "6px 10px", fontSize: "12px" };

  useEffect(() => {
    api.listIngestionSources().then(setSources).catch(() => {});
  }, [api]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setLoading(true);
    try {
      const result = await api.createIngestionSource(newName.trim(), newKind);
      setSources((prev) => [result, ...prev]);
      setPendingToken({ id: result.id, token: result.token });
      setNewName("");
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteIngestionSource(id);
      setSources((prev) => prev.filter((s) => s.id !== id));
    } catch { /* ignore */ }
  }

  async function handleRotate(id: string) {
    try {
      const result = await api.rotateIngestionToken(id);
      setPendingToken({ id, token: result.token });
    } catch { /* ignore */ }
  }

  function copyToken(token: string) {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  function formatAge(ts: string | null): string {
    if (!ts) return "never";
    const diffMs = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 2) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const baseUrl = window.location.origin.replace(/:\d+$/, ":3001");

  return (
    <div>
      <div style={{ marginBottom: "16px", padding: "12px", background: "var(--bg-tertiary)", borderRadius: "8px" }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "8px" }}>Add Ingestion Source</div>
        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. my-project-claude-code"
            style={{ ...localInputStyle, flex: 1 }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as IngestionSourceKind)}
            style={{ ...localInputStyle, background: "var(--bg-secondary)", color: "var(--text-primary)", cursor: "pointer" }}
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>{KIND_DOCS[newKind]}</div>
        <button
          onClick={handleCreate}
          disabled={!newName.trim() || loading}
          style={{ ...buttonPrimary, fontSize: "12px", padding: "4px 16px" }}
        >
          {loading ? "Creating…" : "Create Source"}
        </button>
      </div>

      {pendingToken && (
        <div style={{ marginBottom: "16px", padding: "12px", background: "rgba(34,197,94,0.08)", border: "1px solid var(--accent-green)", borderRadius: "8px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent-green)", marginBottom: "6px" }}>
            Token (shown once — copy now)
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <code style={{ flex: 1, fontSize: "11px", color: "var(--text-primary)", background: "var(--bg-tertiary)", padding: "4px 8px", borderRadius: "4px", wordBreak: "break-all" }}>
              {pendingToken.token}
            </code>
            <button
              onClick={() => copyToken(pendingToken.token)}
              style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", background: "transparent", border: "1px solid var(--accent-green)", color: "var(--accent-green)", whiteSpace: "nowrap" }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={() => setPendingToken(null)}
              style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "4px", cursor: "pointer", background: "transparent", border: "1px solid var(--text-muted)", color: "var(--text-muted)" }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
            POST to: <code style={{ color: "var(--accent-blue)" }}>{baseUrl}/api/ingest/{sources.find((s) => s.id === pendingToken.id)?.kind ?? "…"}</code>
          </div>
        </div>
      )}

      {sources.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: "12px", textAlign: "center", padding: "20px" }}>
          No ingestion sources configured
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {sources.map((s) => (
            <div key={s.id} style={{ padding: "10px", background: "var(--bg-tertiary)", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <div>
                  <span style={{ fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>{s.name}</span>
                  <span style={{
                    marginLeft: "6px", fontSize: "10px", padding: "1px 6px", borderRadius: "3px",
                    background: "rgba(99,102,241,0.15)", color: "var(--accent-purple)",
                  }}>
                    {KIND_LABELS[s.kind]}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button
                    onClick={() => handleRotate(s.id)}
                    style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer", background: "transparent", border: "1px solid var(--accent-yellow)", color: "var(--accent-yellow)" }}
                  >
                    Rotate Token
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "4px", cursor: "pointer", background: "transparent", border: "1px solid var(--accent-red)", color: "var(--accent-red)" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                Last event: {formatAge(s.last_event_at)}
                {s.project_id && <span style={{ marginLeft: "8px" }}>· project bound</span>}
              </div>
              <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px", fontFamily: "monospace" }}>
                POST {baseUrl}/api/ingest/{s.kind}  ·  Bearer &lt;token&gt;
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
