import { useState } from "react";
import { btnStyle } from "./styles";

interface AddProjectControlProps {
  onAdd: (name: string) => Promise<void> | void;
}

export function AddProjectControl({ onAdd }: AddProjectControlProps) {
  const [showForm, setShowForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleAdd() {
    const name = projectName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await onAdd(name);
      setProjectName("");
      setShowForm(false);
    } catch {
      // silently ignore — backend WS will update state if it goes through
    } finally {
      setCreating(false);
    }
  }

  if (!showForm) {
    return (
      <button onClick={() => setShowForm(true)} style={btnStyle("var(--accent-blue)")}>
        + New Project
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
      <input
        autoFocus
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleAdd();
          if (e.key === "Escape") { setShowForm(false); setProjectName(""); }
        }}
        placeholder="Project name..."
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          color: "var(--text-primary)",
          padding: "4px 10px",
          fontSize: "13px",
          width: "180px",
        }}
      />
      <button
        onClick={handleAdd}
        disabled={creating || !projectName.trim()}
        style={btnStyle("var(--accent-green)")}
      >
        Add
      </button>
      <button
        onClick={() => { setShowForm(false); setProjectName(""); }}
        style={btnStyle("var(--text-muted)")}
      >
        Cancel
      </button>
    </div>
  );
}
