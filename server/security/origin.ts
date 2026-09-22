import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";

/**
 * Shared network trust-boundary checks for every entry point that shares the
 * one Express `http.Server`: the `/api` and `/mcp` routers, `/v1/metrics`
 * (OTLP), and the raw `/ws` WebSocket upgrade.
 *
 * Vibe Dash has no authentication by design (see docs/self-hosting.md, "Access
 * control") — the substitute boundary is "only loopback, or an operator's
 * explicit allow-list, may talk to this process". That boundary has to be
 * enforced in code, because a browser tab on an unrelated site can still
 * reach `http://localhost:PORT` directly (the browser doesn't know the
 * dashboard "shouldn't" be reachable) and, via DNS rebinding, can make its
 * `Host` header say `localhost` regardless of which IP the request actually
 * lands on. Checking `Host` is what defeats that: DNS rebinding changes which
 * server answers, not what the browser puts in the header.
 */

export interface AllowedNetwork {
  /** Exact `Host` header values (case-insensitive), e.g. "localhost:3001". */
  hosts: Set<string>;
  /** Exact `Origin` header values (case-insensitive), e.g. "http://localhost:3001". */
  origins: Set<string>;
}

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];

/** Splits a comma-separated env var into trimmed, non-empty entries. */
function parseHostList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Builds the allow-list for one running server.
 *
 * Always includes the loopback hostnames on the port the server itself is
 * bound to — that covers the default, no-configuration case (native run,
 * Docker with the compose-published loopback port, stdio-adjacent tooling).
 *
 * `VIBE_DASH_ALLOWED_HOSTS` is the documented opt-in for a reverse proxy or
 * team deployment (see docs/self-hosting.md, "Reverse proxy + TLS"): a
 * comma-separated list of `host[:port]` values exactly as the proxy forwards
 * them in `Host`, e.g. `vibe-dash.example.com`. Both `http://` and `https://`
 * are accepted as the corresponding `Origin`, since the proxy — not this
 * process — terminates TLS.
 *
 * `includeDevPort` widens the allow-list to also cover Vite's dev server
 * (`vite.config.ts` hardcodes port 3000) proxying to this one. Vite's proxy
 * forwards the browser's original `Host`/`Origin` (`localhost:3000`)
 * unchanged rather than rewriting them to the target, so without this the
 * dev-mode proxy path (`npm run dev`) would trip the same check a real
 * cross-origin request would. Callers pass this only when
 * `NODE_ENV === "development"` specifically — `npm run dev` sets it
 * (see package.json) precisely so this stays off everywhere else, including
 * every documented self-hosted path (native, pm2, systemd), none of which
 * sets `NODE_ENV` at all. An "anything but production" test would have
 * widened the allow-list on those too.
 */
export function buildAllowedNetwork(
  port: number,
  options: { extraHosts?: string; includeDevPort?: boolean } = {}
): AllowedNetwork {
  const hosts = new Set<string>();
  const origins = new Set<string>();

  const addLoopback = (p: number) => {
    for (const hostname of LOOPBACK_HOSTNAMES) {
      hosts.add(`${hostname}:${p}`.toLowerCase());
      origins.add(`http://${hostname}:${p}`.toLowerCase());
    }
  };

  addLoopback(port);
  if (options.includeDevPort) addLoopback(3000);

  for (const extra of parseHostList(options.extraHosts)) {
    const normalized = extra.toLowerCase();
    hosts.add(normalized);
    origins.add(`http://${normalized}`);
    origins.add(`https://${normalized}`);
  }

  return { hosts, origins };
}

/**
 * Resolves the interface `server.listen()` should bind. Loopback unless the
 * operator opts in with `HOST=0.0.0.0` (or any other explicit value) —
 * see the SEC-4 note above `server.listen` in server/index.ts.
 */
export function resolveListenHost(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOST ?? "127.0.0.1";
}

export function isAllowedHost(hostHeader: string | undefined, network: AllowedNetwork): boolean {
  if (!hostHeader) return false;
  return network.hosts.has(hostHeader.toLowerCase());
}

/**
 * An absent `Origin` header is treated as allowed here: it is what every
 * non-browser caller sends (MCP stdio-adjacent HTTP clients, `curl`, OTLP
 * exporters), and browsers omit it only for simple GET/HEAD navigations —
 * never for the state-changing requests this check exists to gate. Callers
 * that need "foreign or absent" semantics (there are none today) should
 * check `hostHeader` presence separately.
 */
export function isAllowedOrigin(originHeader: string | undefined, network: AllowedNetwork): boolean {
  if (!originHeader) return true;
  return network.origins.has(originHeader.toLowerCase());
}

/**
 * Rejects any request whose `Host` header is not in the allow-list. Mounted
 * ahead of every router (`/api`, `/mcp`, `/v1/metrics`, the SPA static
 * files) so DNS rebinding can never make it past this point regardless of
 * which handler would have served the request.
 *
 * 421 (Misdirected Request) is the status HTTP reserves for "this server is
 * not able to produce a response for the combination of scheme and
 * authority in the request" — a closer fit than 403 for a `Host` mismatch.
 */
export function hostValidationMiddleware(network: AllowedNetwork) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const hostHeader = req.headers.host;
    if (!isAllowedHost(hostHeader, network)) {
      res.status(421).json({ error: `Invalid Host header: ${hostHeader ?? "(missing)"}` });
      return;
    }
    next();
  };
}

/**
 * Rejects cross-site state-changing requests. Mounted ahead of every router,
 * so it covers every current and future non-GET route without each handler
 * having to opt in — including the body-less POSTs (ingest scan, task
 * complete, blocker resolve, milestone complete) that have no other CSRF
 * defence, since they never depended on a JSON body to be "incidentally"
 * protected by the content-type preflight the way JSON-body routes are.
 *
 * `Sec-Fetch-Site: cross-site` is Fetch Metadata: every modern browser sends
 * it and it can't be spoofed by the page issuing the request. `Origin` is
 * the fallback for the older or non-browser clients that don't send Fetch
 * Metadata — an absent `Origin` passes (see `isAllowedOrigin`), which is
 * what keeps OTLP exporters and MCP HTTP clients working, since neither is a
 * browser and neither sends either header. This fallback is also what
 * actually blocks a same-SITE-but-different-port attacker (e.g. something
 * bound to `localhost:4000`): `Sec-Fetch-Site` calls that "same-site" and
 * lets it through, but `network.origins` only ever contains this server's
 * own port(s), so the Origin check still rejects it.
 */
export function crossSiteMutationGuard(network: AllowedNetwork) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      next();
      return;
    }

    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
      res.status(403).json({ error: "Cross-site request rejected" });
      return;
    }

    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, network)) {
      res.status(403).json({ error: `Invalid Origin header: ${origin}` });
      return;
    }

    next();
  };
}

/**
 * Same two checks as the HTTP middleware, applied to a WebSocket upgrade
 * request. WebSockets are exempt from the browser's same-origin policy for
 * reading responses, so without this any page can open `ws://localhost:PORT/ws`
 * and receive every broadcast (task rows, activity text, blocker reasons,
 * spend). There is no response body to send a JSON error in during an
 * upgrade, so the caller just refuses the upgrade.
 */
export function isUpgradeAllowed(req: IncomingMessage, network: AllowedNetwork): boolean {
  if (!isAllowedHost(req.headers.host, network)) return false;
  const origin = req.headers.origin;
  if (origin && !network.origins.has(origin.toLowerCase())) return false;
  return true;
}
