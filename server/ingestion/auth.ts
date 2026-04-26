import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { getIngestionSourceByTokenHash, hashToken } from "../db/ingestion.js";
import type { IngestionSource } from "../db/ingestion.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ingestionSource?: IngestionSource;
    }
  }
}

export function makeSourceAuthMiddleware(db: Database.Database) {
  return function sourceAuth(req: Request, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Ingestion source token required" });
      return;
    }
    const token = authHeader.slice(7);
    const source = getIngestionSourceByTokenHash(db, hashToken(token));
    if (!source) {
      res.status(401).json({ error: "Invalid or inactive ingestion source token" });
      return;
    }
    req.ingestionSource = source;
    next();
  };
}
