/** A deliberate, client-facing HTTP error (auth, permission, not-found). */
export class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "forbidden") {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "not found") {
    super(404, message);
  }
}

/**
 * Wraps a plain Error thrown by pre-HTTP service-layer code (e.g.
 * accountingService.closeFiscalYear's "periods X are not yet closed") as a
 * 400. Those functions predate the API layer and throw plain `Error` for
 * business-rule rejections rather than an HttpError, so without this they
 * fall through the error handler's pg-code/ZodError/HttpError checks and
 * surface as a raw 500 -- confirmed live via the fiscal-year-close route
 * before this existed. Use only where the message is known to be a
 * deliberate, client-facing rejection, not a genuine server fault (e.g.
 * not for "chart of accounts is missing required account X", which really
 * is a 500 -- a misconfigured company, not the caller's mistake).
 */
export class BusinessRuleError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

/** Postgres SQLSTATE -> HTTP status for errors surfacing from raw queries
 * (a RAISE EXCEPTION from a business-rule trigger, a unique violation, a
 * FK violation) that weren't already wrapped as an HttpError. */
export function pgErrorStatus(code: string | undefined): number {
  if (!code) return 500;
  if (code === "23505") return 409; // unique_violation
  if (code === "23503") return 400; // foreign_key_violation
  if (code === "23514") return 400; // check_violation
  if (code === "P0001") return 400; // RAISE EXCEPTION from our own trigger functions
  return 500;
}
