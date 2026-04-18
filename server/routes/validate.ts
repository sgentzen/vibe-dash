import type { RequestHandler } from "express";
import type { ZodType } from "zod";

/**
 * Express middleware that validates `req.body` against the provided Zod schema.
 * On success, replaces `req.body` with the parsed (stripped/coerced) data and
 * calls `next()`. On failure, responds with HTTP 400 and a structured error
 * payload describing each validation issue.
 */
export function validateBody(schema: ZodType<unknown>): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
