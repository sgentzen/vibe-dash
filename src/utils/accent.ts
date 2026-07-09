export const ACCENT_STORAGE_KEY = "vibe-dash-accent";
export const DEFAULT_ACCENT = "#58a6ff";

/**
 * Coerce an arbitrary string into a known-safe `#`-prefixed hex color, rebuilt
 * from the validated hex digits (never the raw input), or null when it isn't a
 * valid hex color. Centralizing this keeps tainted values out of browser
 * storage and the `--accent-user` CSS variable on every read and write path.
 */
export function sanitizeAccentColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(raw);
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** Validated accent color from browser storage, or null when unset/invalid. */
export function readStoredAccentColor(): string | null {
  return sanitizeAccentColor(localStorage.getItem(ACCENT_STORAGE_KEY));
}
