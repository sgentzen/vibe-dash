import { describe, it, expect } from "vitest";
import express from "express";
import type { Express } from "express";
import { requestApp, requestAppRaw } from "./http-helper.js";
import { errorHandler } from "../server/routes/middleware.js";

/**
 * Covers `requestAppRaw`'s two edge cases — a payload express.json() cannot
 * parse, and an empty-string payload — against the app wiring that decides
 * what each one looks like coming back.
 *
 * These use a minimal echo app rather than the real router: nothing here is
 * about a route's own validation, so a DB and a mounted createRouter would
 * only add noise between the request and the thing being asserted.
 */

/** Not valid JSON, so express.json() rejects it before any route runs. */
const MALFORMED = "{not valid json";

/**
 * Reflects what the route actually received. `withErrorHandler` mirrors
 * `server/index.ts`, which mounts `errorHandler` last; omitting it reproduces
 * an app wired without one, which is what makes the two shapes below differ.
 */
function echoApp(withErrorHandler: boolean): Express {
  const app = express();
  app.use(express.json());
  app.post("/echo", (req, res) => {
    res.json({ body: req.body, contentLength: req.headers["content-length"] ?? null });
  });
  if (withErrorHandler) app.use(errorHandler);
  return app;
}

describe("requestAppRaw with a payload that is not valid JSON", () => {
  it("answers 400 in HTML when the app has no errorHandler", async () => {
    const { status, body } = await requestAppRaw(echoApp(false), "POST", "/echo", MALFORMED);

    // 400, not 500: body-parser puts `status: 400` on the SyntaxError it
    // throws, and Express's default handler honours it. The status is the
    // *only* part that survives the missing errorHandler — the body comes
    // back as an HTML error page, so `body.error` is undefined and any
    // assertion written in this suite's usual `{ error }` idiom would fail
    // for a reason that has nothing to do with the route under test.
    expect(status).toBe(400);
    expect(typeof body).toBe("string");
    expect(body as string).toContain("<html");
  });

  it("answers 400 in the suite's JSON shape when errorHandler is mounted", async () => {
    const { status, body } = await requestAppRaw(echoApp(true), "POST", "/echo", MALFORMED);

    expect(status).toBe(400);
    // The message is body-parser relaying V8's parse error, whose exact
    // wording moves between Node releases, so only the shape is pinned.
    // errorHandler masks the message for 500s only, so a 400 passes it through.
    expect(body).toEqual({ error: expect.any(String) });
    expect((body as { error: string }).error).not.toBe("");
  });

  // A top-level primitive is valid JSON, so it fails a different way: strict
  // mode rejects it before JSON.parse is reached, where MALFORMED fails inside
  // JSON.parse. Both surface as a 400 in the same shape, which is the part
  // worth pinning — the two are easy to assume identical and are not.
  it.each(["null", "42", '"a string"'])("rejects the top-level primitive %s", async (payload) => {
    const { status, body } = await requestAppRaw(echoApp(true), "POST", "/echo", payload);

    expect(status).toBe(400);
    expect(body).toEqual({ error: expect.any(String) });
  });
});

describe("requestAppRaw with an empty-string payload", () => {
  it("sends an empty body that express.json() parses to {}", async () => {
    const { status, body } = await requestAppRaw(echoApp(true), "POST", "/echo", "");

    expect(status).toBe(200);
    expect(body).toEqual({ body: {}, contentLength: "0" });
  });

  it("is indistinguishable from omitting the body entirely", async () => {
    // Both forms arrive as Content-Length: 0 — Node's HTTP client adds that
    // header itself for a request that writes no body, so the helper setting
    // it explicitly for "" changes nothing observable. Recorded because the
    // helper's `payload !== undefined` checks read as though they draw a
    // distinction here: they do not, and this pins that they cannot.
    const empty = await requestAppRaw(echoApp(true), "POST", "/echo", "");
    const omitted = await requestApp(echoApp(true), "POST", "/echo");

    expect(omitted).toEqual(empty);
  });
});
