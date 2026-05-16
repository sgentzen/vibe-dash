import type Database from "better-sqlite3";

export interface DetectorContext {
  db: Database.Database;
  now: string; // ISO timestamp — fixed per run for deterministic scoring
}

export type EntityType = "task" | "agent" | "blocker" | "review" | "commit" | "milestone" | "area";

export interface Match {
  entityId: string;
  entityType: EntityType;
  label: string;
  detail?: string;
}

export interface ScoredMatch extends Match {
  detectorId: string;
  category: string;
  score: number; // 0–100
}

export interface Detector {
  id: string;
  category: string;
  defaultThreshold: number; // matches with score < defaultThreshold are suppressed
  predicate: (ctx: DetectorContext) => Match[];
  score: (match: Match, ctx: DetectorContext) => number;
}
