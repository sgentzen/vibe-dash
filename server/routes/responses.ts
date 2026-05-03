import type { Response } from "express";

export function notFound(res: Response, message = "Not found"): void {
  res.status(404).json({ error: message });
}

export function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

export function conflict(res: Response, message: string): void {
  res.status(409).json({ error: message });
}

export function serverError(res: Response, message = "Internal server error"): void {
  res.status(500).json({ error: message });
}

export function unauthorized(res: Response, message = "Unauthorized"): void {
  res.status(401).json({ error: message });
}

export function forbidden(res: Response, message = "Forbidden"): void {
  res.status(403).json({ error: message });
}
