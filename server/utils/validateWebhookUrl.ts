const BLOCKED_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^fe80:/i,
  /^f[cd][0-9a-f]{2}:/i,
  /^metadata\.google\.internal$/i,
];

/** Returns an error message string if the URL is invalid or targets a private address, or null if OK. */
export function validateWebhookUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http/https URLs are allowed";
  }
  // URL.hostname returns IPv6 addresses with brackets (e.g. "[::1]"); strip them before matching
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_PATTERNS.some((p) => p.test(host))) {
    return "URL must not target private, loopback, or link-local addresses";
  }
  return null;
}
