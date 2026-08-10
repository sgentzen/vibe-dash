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
    // `agent: false` opts out of http.globalAgent, which defaults to
    // keepAlive on Node 18+. Each call here binds a throwaway server to an
    // ephemeral port, so a pooled socket outliving its server can be handed to
    // a later request once the OS recycles that port — which surfaces as one
    // test seeing another's response. Rare, but it did reproduce under full
    // suite concurrency. An unpooled socket closes with its response.
    const req = http.request({ ...options, agent: false }, resolve);
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Closes the one-shot server and waits for it to stop listening. */
function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
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

export interface RequestAppOptions {
  /**
   * Overrides the default `application/json`. A non-JSON type makes
   * `express.json()` skip the body entirely, which is how a client that forgets
   * the header reaches a route with `req.body` still `undefined` under
   * Express 5. The payload itself is still JSON-encoded, so the only thing
   * under test is the missing content type.
   */
  contentType?: string;
}

/**
 * Minimal HTTP helper: mounts `app` on a one-shot server bound to a random
 * port, issues a single request, then tears the server down. The body is
 * JSON-parsed when possible and returned as raw text otherwise.
 *
 * Awaiting each step keeps the callback nesting shallow — the previous
 * inline version nested five deep (promise -> listen -> request -> response
 * -> stream events), which Sonar flags as S2004.
 */
export async function requestApp(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
  options?: RequestAppOptions,
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  const port = await listen(server);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  try {
    const res = await send(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": options?.contentType ?? "application/json",
          ...(payload ? { "Content-Length": String(Buffer.byteLength(payload)) } : {}),
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
    // Awaited, so the next call cannot bind while this one is still draining.
    await close(server);
  }
}
