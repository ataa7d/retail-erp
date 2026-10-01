import { apiRequest } from "./api";

interface BulkResultRow {
  id: string;
  ok: boolean;
  status?: string;
  error?: string;
}

/**
 * Posts to one of the backend's `bulk-*` endpoints (bulk-post, bulk-approve,
 * bulk-reject, ...) and summarizes the per-row results into one line, so a
 * partial failure ("7 posted, 1 already posted by someone else") is visible
 * instead of silently swallowed.
 */
export async function runBulkAction(
  path: string,
  ids: string[],
  opts: { token: string | null; companyId: string | null; body?: Record<string, unknown> },
): Promise<string> {
  const { results } = await apiRequest<{ results: BulkResultRow[] }>(path, {
    method: "POST",
    token: opts.token,
    companyId: opts.companyId,
    body: { ids, ...opts.body },
  });
  const okCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return `${okCount} succeeded.`;
  return `${okCount} succeeded, ${failed.length} failed: ${failed.map((f) => f.error).join("; ")}`;
}
