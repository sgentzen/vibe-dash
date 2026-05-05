import { useEffect, useState } from "react";

interface PluginInfo {
  name: string;
  version: string;
  description: string | null;
  type: string;
  label: string | null;
  width: number | null;
  status: "active" | "error";
  error: string | null;
}

interface PluginWidgetProps {
  plugin: PluginInfo;
}

export function PluginWidget({ plugin }: PluginWidgetProps) {
  const label = plugin.label ?? plugin.name;
  const hasError = plugin.status === "error";

  const containerStyle: React.CSSProperties = {
    border: `1px solid ${hasError ? "var(--accent-red)" : "var(--border)"}`,
    borderRadius: 8,
    padding: "12px 16px",
    background: "var(--bg-secondary)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minHeight: 80,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 600,
    fontSize: 14,
    color: "var(--text-primary)",
  };

  const badgeStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    background: hasError ? "var(--accent-red)" : "var(--accent-green, #22c55e)",
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  const descStyle: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
  };

  return (
    <div style={containerStyle} role="region" aria-label={`Plugin: ${label}`}>
      <div style={headerStyle}>
        <span>{label}</span>
        <span style={badgeStyle}>{hasError ? "error" : plugin.type}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted, var(--text-secondary))", fontWeight: 400 }}>
          v{plugin.version}
        </span>
      </div>
      {plugin.description && (
        <p style={descStyle}>{plugin.description}</p>
      )}
      {hasError && (
        <p style={{ ...descStyle, color: "var(--accent-red)", fontFamily: "monospace" }}>
          {plugin.error}
        </p>
      )}
    </div>
  );
}

interface PluginPanelProps {
  style?: React.CSSProperties;
}

export function PluginPanel({ style }: PluginPanelProps) {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  async function fetchPlugins() {
    try {
      const res = await fetch("/api/plugins");
      if (res.ok) {
        const data = await res.json() as { plugins: PluginInfo[] };
        setPlugins(data.plugins);
      }
    } catch {
      // ignore — server may be starting up
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchPlugins(); }, []);

  async function handleReload() {
    setReloading(true);
    try {
      await fetch("/api/plugins/reload", { method: "POST" });
      await fetchPlugins();
    } finally {
      setReloading(false);
    }
  }

  const panelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  };

  const reloadBtnStyle: React.CSSProperties = {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-tertiary, var(--bg-secondary))",
    color: "var(--text-primary)",
    cursor: reloading ? "not-allowed" : "pointer",
    opacity: reloading ? 0.6 : 1,
  };

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
          Plugins
        </h3>
        <button
          style={reloadBtnStyle}
          onClick={handleReload}
          disabled={reloading}
          aria-label="Reload plugins from disk"
        >
          {reloading ? "Reloading…" : "Reload"}
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--status-warning, #f59e0b)", margin: "0 0 4px", lineHeight: 1.4 }}>
        <strong>Security notice:</strong> Plugins in{" "}
        <code style={{ fontFamily: "monospace" }}>~/.vibe-dash/plugins/</code> run as
        arbitrary code with server-level access. Only install plugins you trust completely.
      </p>

      {loading ? (
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading plugins…</p>
      ) : plugins.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          No plugins installed. Add plugin directories to{" "}
          <code style={{ fontFamily: "monospace" }}>~/.vibe-dash/plugins/</code>.
        </p>
      ) : (
        plugins.map((p) => <PluginWidget key={p.name} plugin={p} />)
      )}
    </div>
  );
}
