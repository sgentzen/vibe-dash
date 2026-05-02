import type { IngestionEventKind, IngestionSourceKind } from "../db/ingestion.js";

export interface NormalizedEvent {
  kind: IngestionEventKind;
  agent_name?: string | null;
  task_id?: string | null;
  message?: string | null;
  model?: string | null;
  provider?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  project_id?: string | null;
  file_path?: string | null;
  tool_name?: string | null;
  session_id?: string | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function fromClaudeCodeHook(payload: Record<string, unknown>): NormalizedEvent | null {
  const hookEvent = str(payload.hook_event_name) ?? str(payload.event);
  if (!hookEvent) return null;

  const agentName = str(payload.session_id) ?? str(payload.cwd);
  const costUsd = num(payload.cost_usd) ?? num(payload.total_cost);
  const inputTokens = num(payload.input_tokens) ?? num((obj(payload.usage)).input_tokens);
  const outputTokens = num(payload.output_tokens) ?? num((obj(payload.usage)).output_tokens);

  if (hookEvent === "Stop") {
    return {
      kind: "session_end",
      agent_name: agentName,
      message: str(payload.stop_reason) ?? "session ended",
      cost_usd: costUsd,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      model: str(payload.model),
      provider: "anthropic",
    };
  }

  if (hookEvent === "UserPromptSubmit") {
    return {
      kind: "session_start",
      agent_name: agentName,
      message: "session started",
    };
  }

  if (hookEvent === "PreToolUse") {
    return {
      kind: "tool_call",
      agent_name: agentName,
      tool_name: str(payload.tool_name) ?? str((obj(payload.tool_input)).tool_name),
      message: `tool_use: ${str(payload.tool_name) ?? "unknown"}`,
    };
  }

  if (hookEvent === "PostToolUse") {
    const isFileChange =
      ["Write", "Edit", "MultiEdit"].includes(str(payload.tool_name) ?? "") ||
      (str(payload.tool_name) ?? "").toLowerCase().includes("write");
    if (isFileChange) {
      return {
        kind: "file_change",
        agent_name: agentName,
        file_path: str((obj(payload.tool_input)).file_path) ?? str((obj(payload.tool_input)).path),
        message: `file modified by ${str(payload.tool_name) ?? "tool"}`,
        cost_usd: costUsd,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: str(payload.model),
        provider: "anthropic",
      };
    }
    return {
      kind: "tool_call",
      agent_name: agentName,
      tool_name: str(payload.tool_name),
      message: `tool_result: ${str(payload.tool_name) ?? "unknown"}`,
    };
  }

  return null;
}

export function fromCursorEvent(payload: Record<string, unknown>): NormalizedEvent | null {
  const eventType = str(payload.type) ?? str(payload.event_type);
  if (!eventType) return null;
  const agentName = str(payload.agent_id) ?? str(payload.session_id);
  if (eventType === "session_start") return { kind: "session_start", agent_name: agentName, message: "Cursor session started" };
  if (eventType === "session_end") {
    return {
      kind: "session_end",
      agent_name: agentName,
      message: "Cursor session ended",
      cost_usd: num(payload.cost),
      input_tokens: num(payload.input_tokens),
      output_tokens: num(payload.output_tokens),
      model: str(payload.model),
      provider: "cursor",
    };
  }
  if (eventType === "tool_call" || eventType === "tool_use") {
    return { kind: "tool_call", agent_name: agentName, tool_name: str(payload.tool), message: str(payload.description) };
  }
  if (eventType === "file_edit" || eventType === "file_write") {
    return { kind: "file_change", agent_name: agentName, file_path: str(payload.file), message: "file changed" };
  }
  return { kind: "activity", agent_name: agentName, message: str(payload.message) ?? eventType };
}

export function fromCodexEvent(payload: Record<string, unknown>): NormalizedEvent | null {
  const role = str(payload.role);
  if (!role) return null;
  const agentName = str(payload.session_id) ?? "codex";
  if (role === "system") {
    const content = str(payload.content) ?? "";
    if (content.includes("session_start")) return { kind: "session_start", agent_name: agentName, message: content };
    if (content.includes("session_end")) return { kind: "session_end", agent_name: agentName, message: content };
  }
  const usage = obj(payload.usage);
  return {
    kind: "activity",
    agent_name: agentName,
    message: str(payload.content) ?? str(payload.text),
    input_tokens: num(usage.input_tokens) ?? num(usage.prompt_tokens),
    output_tokens: num(usage.output_tokens) ?? num(usage.completion_tokens),
    cost_usd: num(payload.cost),
    model: str(payload.model),
    provider: "openai",
  };
}

export function fromCopilotEvent(payload: Record<string, unknown>): NormalizedEvent | null {
  const action = str(payload.action) ?? str(payload.event);
  if (!action) return null;
  const agentName = str(payload.workspace_id) ?? str(payload.session_id) ?? "copilot";
  if (action === "session.start" || action === "start") return { kind: "session_start", agent_name: agentName, message: "Copilot Workspace session started" };
  if (action === "session.end" || action === "end") return { kind: "session_end", agent_name: agentName, message: "Copilot Workspace session ended", cost_usd: num(payload.cost) };
  if (action === "edit" || action === "file_change") {
    return { kind: "file_change", agent_name: agentName, file_path: str(payload.file) ?? str(payload.path), message: "file edited" };
  }
  return { kind: "activity", agent_name: agentName, message: str(payload.message) ?? action };
}

export function fromAiderEvent(payload: Record<string, unknown>): NormalizedEvent | null {
  const eventType = str(payload.type) ?? str(payload.event);
  const agentName = str(payload.session_id) ?? "aider";
  if (!eventType) {
    // Aider JSON output line without explicit type
    const cost = num(payload.cost) ?? num(payload.total_cost_usd);
    if (cost !== null) {
      return {
        kind: "cost",
        agent_name: agentName,
        cost_usd: cost,
        input_tokens: num(payload.tokens_sent),
        output_tokens: num(payload.tokens_received),
        model: str(payload.model),
        provider: "aider",
      };
    }
    return { kind: "activity", agent_name: agentName, message: str(payload.message) ?? str(payload.content) };
  }
  if (eventType === "cost") {
    return {
      kind: "cost",
      agent_name: agentName,
      cost_usd: num(payload.cost) ?? num(payload.total_cost_usd),
      input_tokens: num(payload.tokens_sent),
      output_tokens: num(payload.tokens_received),
      model: str(payload.model),
      provider: "aider",
    };
  }
  if (eventType === "file_change" || eventType === "edit") {
    return { kind: "file_change", agent_name: agentName, file_path: str(payload.file), message: "file changed" };
  }
  return { kind: "activity", agent_name: agentName, message: str(payload.message) ?? eventType };
}

export function fromGeneric(payload: Record<string, unknown>): NormalizedEvent | null {
  const kind = str(payload.kind) as IngestionEventKind | null;
  const validKinds: IngestionEventKind[] = ["activity", "cost", "tool_call", "file_change", "session_start", "session_end"];
  const normalizedKind: IngestionEventKind = kind && validKinds.includes(kind) ? kind : "activity";
  return {
    kind: normalizedKind,
    agent_name: str(payload.agent_name) ?? str(payload.agent),
    task_id: str(payload.task_id),
    message: str(payload.message),
    model: str(payload.model),
    provider: str(payload.provider),
    input_tokens: num(payload.input_tokens),
    output_tokens: num(payload.output_tokens),
    cost_usd: num(payload.cost_usd),
    project_id: str(payload.project_id),
    file_path: str(payload.file_path),
    tool_name: str(payload.tool_name),
    session_id: str(payload.session_id),
  };
}

export function normalize(
  kind: IngestionSourceKind,
  payload: Record<string, unknown>
): NormalizedEvent | null {
  switch (kind) {
    case "claude_code": return fromClaudeCodeHook(payload);
    case "cursor": return fromCursorEvent(payload);
    case "codex": return fromCodexEvent(payload);
    case "copilot": return fromCopilotEvent(payload);
    case "aider": return fromAiderEvent(payload);
    case "generic": return fromGeneric(payload);
  }
}
