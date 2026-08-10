import http, { createServer, type IncomingMessage, type Server } from "node:http";
import type { Express } from "express";

/** Resolves once the one-shot server is listening, with the port it picked. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as { port: number }).port);
    });
  });
}

/** Issues the request and resolves with the response head. */
function send(options: http.RequestOptions, payload?: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, resolve);
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Collects a response body into a string. */
function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    res.on("data", (chunk: Buffer) => { data += chunk; });
    res.on("end", () => resolve(data));
    res.on("error", reject);
  });
}

/** Minimal HTTP helper: JSON-serialises `body` and delegates to `requestAppRaw`. */
export function requestApp(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return requestAppRaw(app, method, path, body === undefined ? undefined : JSON.stringify(body));
}

/**
 * Mounts `app` on a one-shot server bound to a random port, issues a single
 * request sending `payload` verbatim as the body, then tears the server down.
 * The response body is JSON-parsed when possible and returned as raw text
 * otherwise.
 *
 * Taking an already-serialised payload is what lets callers reach bodies
 * JSON.stringify cannot produce — e.g. `1e400`, which parses to `Infinity` on
 * the server but stringifies back to `null` on the way out.
 *
 * Awaiting each step keeps the callback nesting shallow — the previous
 * inline version nested five deep (promise -> listen -> request -> response
 * -> stream events), which Sonar flags as S2004.
 */
export async function requestAppRaw(
  app: Express,
  method: string,
  path: string,
  payload?: string,
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  const port = await listen(server);
  try {
    const res = await send(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload === undefined ? {} : { "Content-Length": String(Buffer.byteLength(payload)) }),
        },
      },
      payload,
    );
    const data = await readBody(res);
    const status = res.statusCode ?? 0;
    try {
      return { status, body: JSON.parse(data) };
    } catch {
      return { status, body: data };
    }
  } finally {
    server.close();
  }
}
