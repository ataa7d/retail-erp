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
