import type { Request, Response, NextFunction, RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../logger.js";

// ─── Rate Limiters ──────────────────────────────────────────────────────────

/**
 * Factory for per-endpoint read limiters. Each call returns a fresh middleware
 * instance with its own counter, so unrelated endpoints don't share a budget.
 * The dashboard legitimately polls multiple endpoints every 3s, so 120/min
 * gives healthy headroom for both polling and React StrictMode double-effects.
 */
export const makeReadLimiter = (max = 120) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
  });

export const statsLimiter = makeReadLimiter(120);

export const firstRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const dependencyDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
});

// ─── Error Handling ─────────────────────────────────────────────────────────

/**
 * Wraps an async route handler so rejected promises are forwarded to
 * Express error middleware instead of becoming unhandled rejections.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

/**
 * 404 handler for unknown `/api/*` routes. Mount after all route
 * modules but before the SPA catch-all and errorHandler.
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  if (req.path.startsWith("/api/")) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

/**
 * Centralized error handler. Must be the last middleware mounted.
 * Express identifies error handlers by their 4-parameter signature.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const e = err as Error & { status?: number; statusCode?: number };
  const status = e.status ?? e.statusCode ?? 500;
  logger.error({ err, status }, "Unhandled route error");
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
}
