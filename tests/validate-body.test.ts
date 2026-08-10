import { describe, it, expect } from "vitest";
import express from "express";
import { z } from "zod";
import { validateBody } from "../server/routes/validate.js";
import { requestApp } from "./http-helper.js";

describe("validateBody", () => {
  /**
   * This is the boundary that lets every validateBody-fronted route keep
   * destructuring `req.body` unguarded. When a client omits
   * Content-Type: application/json, express.json() leaves req.body undefined,
   * and a bare destructure of undefined throws a 500. Those routes are safe
   * only because safeParse rejects undefined here first, so the handler never
   * runs. Swapping a schema for one that accepts undefined, or letting an
   * unparsed body through to next(), would reopen that hole across ten routes
   * at once — hence a test on the middleware rather than on each route.
   */
  it("400s when the body was never parsed as JSON, without reaching the handler", async () => {
    let handlerRan = false;
    const app = express();
    app.use(express.json());
    app.post("/thing", validateBody(z.object({ name: z.string() })), (_req, res) => {
      handlerRan = true;
      res.json({ ok: true });
    });

    const res = await requestApp(app, "POST", "/thing", { name: "x" }, { contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toBe("Validation failed");
    expect(handlerRan).toBe(false);
  });

  /**
   * The all-optional shape is the one a maintainer would actually doubt:
   * updateTaskSchema, updateMilestoneSchema and updateProjectSchema require
   * nothing, which reads as though an absent body ought to be acceptable. It
   * is not — z.object still demands an object — and the PATCH routes behind
   * those schemas destructure unguarded, so this is the case worth pinning.
   */
  it("400s on an unparsed body even when every field is optional", async () => {
    let handlerRan = false;
    const app = express();
    app.use(express.json());
    app.patch("/thing", validateBody(z.object({ name: z.string().optional() })), (_req, res) => {
      handlerRan = true;
      res.json({ ok: true });
    });

    const res = await requestApp(app, "PATCH", "/thing", { name: "x" }, { contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(handlerRan).toBe(false);
  });
});
