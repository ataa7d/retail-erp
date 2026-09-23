const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  companyId?: string | null;
  token?: string | null;
}

/**
 * Thin fetch wrapper over the retail-erp API. Every write goes through the
 * server's one-transaction-per-request model already (src/api/db.ts on the
 * backend) — this layer just attaches the auth headers and normalizes
 * errors, it doesn't retry or dedupe anything.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // Fastify's JSON body parser rejects an empty body when Content-Type is
  // set to application/json — only set it when there's actually a body
  // (e.g. the many "create X, then POST X/:id/post" calls send no body).
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.companyId) headers["X-Company-Id"] = options.companyId;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let payload: { error?: string; details?: unknown } = {};
    try {
      payload = await res.json();
    } catch {
      // non-JSON error body; fall through with a generic message
    }
    throw new ApiError(res.status, payload.error ?? `request failed with status ${res.status}`, payload.details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
