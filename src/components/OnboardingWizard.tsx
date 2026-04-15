import { useState } from "react";
import FocusTrap from "focus-trap-react";
import { useApi } from "../hooks/useApi";
import { inputStyle, buttonPrimary, buttonSecondary, sectionHeader } from "../styles/shared.js";

interface OnboardingWizardProps {
  onComplete: () => void;
}

const MCP_CONFIG_TEMPLATE = `{
  "mcpServers": {
    "vibe-dash": {
      "command": "npx",
      "args": ["tsx", "<PATH_TO_VIBE_DASH>/server/mcp/stdio.ts"]
    }
  }
}`;

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const api = useApi();
  const [step, setStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);

  async function handleCreateProject() {
    if (!projectName.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: projectName.trim(),
        description: projectDesc.trim() || undefined,
      });
      setCreatedProjectId(project.id);
      setStep(1);
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateSampleTask() {
    if (!createdProjectId) return;
    setCreating(true);
    try {
      await api.createTask({
        project_id: createdProjectId,
        title: "My first task",
        description: "Created during onboarding",
        priority: "medium",
      });
      onComplete();
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  }

  function handleCopyConfig() {
    navigator.clipboard.writeText(MCP_CONFIG_TEMPLATE).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <FocusTrap focusTrapOptions={{ escapeDeactivates: false }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Getting started wizard"
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "32px",
          maxWidth: "480px",
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}>
          {/* Step indicators */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "24px" }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1, height: "3px", borderRadius: "2px",
                  background: i <= step ? "var(--accent-blue)" : "var(--border)",
                  transition: "background 0.3s",
                }}
              />
            ))}
          </div>

          {step === 0 && (
            <>
              <h2 style={{ color: "var(--text-primary)", fontSize: "18px", marginBottom: "4px" }}>
                Welcome to Vibe Dash
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "20px" }}>
                Create your first project to get started.
              </p>
              <div style={{ marginBottom: "12px" }}>
                <label htmlFor="onboard-project-name" style={labelStyle}>Project Name</label>
                <input
                  id="onboard-project-name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateProject(); }}
                  placeholder="My AI Project"
                  autoFocus
                  style={inputStyle}
                />
              </div>
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="onboard-project-desc" style={labelStyle}>Description (optional)</label>
                <input
                  id="onboard-project-desc"
                  value={projectDesc}
                  onChange={(e) => setProjectDesc(e.target.value)}
                  placeholder="What are you building?"
                  style={inputStyle}
                />
              </div>
              <button
                onClick={handleCreateProject}
                disabled={creating || !projectName.trim()}
                style={primaryBtnStyle}
              >
                {creating ? "Creating..." : "Create Project"}
              </button>
            </>
          )}

          {step === 1 && (
            <>
              <h2 style={{ color: "var(--text-primary)", fontSize: "18px", marginBottom: "4px" }}>
                Connect an Agent
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "16px" }}>
                Add this to your <code style={{ color: "var(--accent-blue)" }}>.mcp.json</code> to connect Claude Code or other MCP clients.
              </p>
              <div style={{
                background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                borderRadius: "6px", padding: "12px", fontFamily: "monospace",
                fontSize: "12px", color: "var(--text-primary)",
                whiteSpace: "pre", overflow: "auto", marginBottom: "12px",
                maxHeight: "160px",
              }}>
                {MCP_CONFIG_TEMPLATE}
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={handleCopyConfig} style={secondaryBtnStyle}>
                  {copied ? "Copied!" : "Copy Config"}
                </button>
                <button onClick={() => setStep(2)} style={primaryBtnStyle}>
                  Next
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={{ color: "var(--text-primary)", fontSize: "18px", marginBottom: "4px" }}>
                Create Your First Task
              </h2>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "20px" }}>
                We'll create a sample task so you can see the board in action. You can skip this and create tasks later.
              </p>
              <div style={{ display: "flex", gap: "10px" }}>
                <button onClick={handleCreateSampleTask} disabled={creating} style={primaryBtnStyle}>
                  {creating ? "Creating..." : "Create Sample Task"}
                </button>
                <button onClick={onComplete} style={secondaryBtnStyle}>
                  Skip
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </FocusTrap>
  );
}

const labelStyle: React.CSSProperties = { ...sectionHeader, display: "block", marginBottom: "5px" };

const primaryBtnStyle: React.CSSProperties = { ...buttonPrimary, fontWeight: 600, padding: "8px 20px" };

const secondaryBtnStyle: React.CSSProperties = { ...buttonSecondary, padding: "8px 20px" };
