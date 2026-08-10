/** One priced-able assistant turn extracted from a Claude Code transcript. */
export interface UsageRecord {
  /** The transcript record's own uuid. Doubles as the idempotency key. */
  uuid: string;
  sessionId: string;
  timestamp: string;
  /** Working directory the session ran in. Used for project attribution. */
  cwd: string | null;
  gitBranch: string | null;
  model: string;
  /** "standard" or "fast". Fast mode is priced differently. */
  speed: string | null;
  /** True for subagent turns, which are billed the same but worth flagging. */
  isSidechain: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
}

export interface ParseResult {
  records: UsageRecord[];
  /** Lines that could not be used. Surfaced so a format change is visible. */
  skippedLines: number;
  bytesRead: number;
  lastUuid: string | null;
}

export interface SyncOptions {
  /** Override the Claude home. Tests point this at a fixture directory. */
  claudeHome?: string;
}

export interface SyncResult {
  filesScanned: number;
  recordsIngested: number;
  recordsSkipped: number;
  /** Ingested but with cost_usd NULL because the model is not in the price table. */
  unpriced: number;
  /** Ingested but with project_id NULL because no project_paths row matched. */
  unattributed: number;
}
