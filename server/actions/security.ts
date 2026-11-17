/**
 * LENORY ACTIONS security helpers.
 * - SSRF protection for browser navigation
 * - URL allow/block checks after redirects
 * - Never expand permissions based on page content
 */

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^0\.0\.0\.0$/,
  /^\[::1\]$/,
  /^::1$/,
  /^metadata\.google\.internal$/i,
  /^169\.254\./, // link-local / cloud metadata
];

const BLOCKED_SCHEMES = new Set(["file", "ftp", "javascript", "data", "blob", "about"]);

/** Returns null if OK, or a human-readable reason if blocked. */
export function assertPublicHttpUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Invalid URL";
  }
  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return `Scheme "${scheme}" is not allowed (only http/https)`;
  }
  if (BLOCKED_SCHEMES.has(scheme)) {
    return `Scheme "${scheme}" is blocked`;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  for (const re of BLOCKED_HOST_PATTERNS) {
    if (re.test(host)) {
      return `Host "${host}" is blocked (private/internal network)`;
    }
  }
  // Numeric IPv4 private ranges already covered; reject bare IPs that look internal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) {
      return `IP "${host}" is blocked`;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return `IP "${host}" is blocked`;
    if (parts[0] === 192 && parts[1] === 168) return `IP "${host}" is blocked`;
    if (parts[0] === 169 && parts[1] === 254) return `IP "${host}" is blocked`;
  }
  return null;
}

export function isUrlAllowed(raw: string): boolean {
  return assertPublicHttpUrl(raw) === null;
}

/** Default max steps / timeouts for a single browser task */
export const BROWSER_LIMITS = {
  maxPages: 8,
  navigationTimeoutMs: 30_000,
  taskTimeoutMs: 120_000,
  maxScreenshotBytes: 4 * 1024 * 1024,
};
